import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import {
  createAccountLink,
  escapeHtml,
  findAuthUserByEmail,
  type AccountLinkType,
} from "@/lib/auth-links";
import { sendEmail } from "@/lib/email";

// Auto-invite trigger. Used by:
//   - enrollment-notifications.ts notifyApproved() (when admin approves
//     an enrollment + the participant has no account)
//   - the HitPay webhook paid-flip handler (when payment arrives + the
//     participant has no account)
//   - the recruit flow's "Take payment now" / link-share paths
//   - admin-triggered manual invite from the participant detail page (future)
//
// Idempotent: only fires if auth_user_id is still null at trigger time.
// Safe to call defensively from anywhere — extra calls are no-ops.
//
// The email contains a one-time link to /auth/account where the participant
// sets their password and their login is linked to their record.

const LINK_COOLDOWN_MS = 5 * 60 * 1000;

export type InviteVia =
  | "enrollment_approved"
  | "payment_received"
  | "recruit_lead_added"
  | "manual";

export type InviteResult =
  | { status: "sent"; user_id: string }
  | { status: "skipped"; reason: "already_linked" | "no_email" | "participant_not_found" }
  | { status: "error"; message: string };

export async function inviteParticipantToAccountIfNeeded(
  participantId: string,
  via: InviteVia,
): Promise<InviteResult> {
  const service = createSupabaseServiceClient();

  const { data: participant, error } = await service
    .from("participants")
    .select("id, email, auth_user_id, region_id, name_en, name_cn")
    .eq("id", participantId)
    .maybeSingle();

  if (error || !participant) {
    console.warn(
      `[participant-invite] participant ${participantId} not found (via=${via}): ${error?.message ?? "missing"}`,
    );
    return { status: "skipped", reason: "participant_not_found" };
  }

  if (participant.auth_user_id) {
    return { status: "skipped", reason: "already_linked" };
  }
  if (!participant.email) {
    return { status: "skipped", reason: "no_email" };
  }

  // An existing login means they were already invited or have an account.
  // They can get a fresh link from Set up account on the sign-in page.
  if (await findAuthUserByEmail(participant.email)) {
    return { status: "skipped", reason: "already_linked" };
  }

  const sent = await sendParticipantAccountLink(
    participant.email,
    participant.name_en || participant.name_cn || "",
  );
  if (sent.status !== "sent") {
    console.warn(`[participant-invite] link not sent (via=${via}): ${sent.status}`);
    return { status: "error", message: sent.status };
  }

  await writeAuditLog({
    actor_id: null,
    action: "participant.account_invite_sent",
    entity: "participants",
    entity_id: participant.id,
    metadata: {
      via,
      region_id: participant.region_id,
      auth_user_id: sent.user_id,
    },
  });

  return { status: "sent", user_id: sent.user_id };
}

export type AccountLinkResult =
  | { status: "sent"; user_id: string; type: AccountLinkType }
  | { status: "cooldown" | "failed" };

// Sends a set-password link: an invite for a new login, otherwise a reset.
// The public forms can call this, so one address gets one link per 5 minutes.
export async function sendParticipantAccountLink(
  email: string,
  name: string,
): Promise<AccountLinkResult> {
  const user = await findAuthUserByEmail(email);
  if (user) {
    const last = Math.max(
      user.recovery_sent_at ? new Date(user.recovery_sent_at).getTime() : 0,
      user.invited_at ? new Date(user.invited_at).getTime() : 0,
    );
    if (Date.now() - last < LINK_COOLDOWN_MS) return { status: "cooldown" };
  }

  const type: AccountLinkType = user ? "recovery" : "invite";
  const link = await createAccountLink(email, type, "/auth/account");
  if ("error" in link) {
    console.warn(`[participant-invite] link failed: ${link.error}`);
    return { status: "failed" };
  }

  const safeName = escapeHtml(name);
  const url = escapeHtml(link.url);
  const isInvite = type === "invite";
  const greetingEn = safeName ? `Hi ${safeName},` : "Hi,";
  const greetingZh = safeName ? `${safeName}，您好：` : "您好：";
  const result = await sendEmail({
    to: email,
    subject: isInvite
      ? "Set up your GMC account · 设置您的 GMC 账户"
      : "Set your GMC password · 设置您的 GMC 密码",
    html: `<p>${greetingEn}</p>
<p>${isInvite ? "Your GMC account is ready." : "We received a request to set your GMC password."} Open the link below and choose a password.</p>
<p><a href="${url}">Set my password</a></p>
<p>This link works once and expires. If it has expired, request a new one on the sign-in page.${isInvite ? "" : " If you didn't ask for this, you can ignore this email."}</p>
<hr />
<p>${greetingZh}</p>
<p>${isInvite ? "您的 GMC 账户已准备就绪。" : "我们收到了设置您 GMC 密码的请求。"}请打开以下链接并设置密码。</p>
<p><a href="${url}">设置我的密码</a></p>
<p>此链接仅可使用一次，并会过期。如已过期，请在登录页面重新申请。${isInvite ? "" : "如果这不是您本人的操作，请忽略此邮件。"}</p>`,
    textFooter: `Set your password · 设置密码: ${link.url}`,
  });

  if (result.mocked || result.error) {
    // Remove an unused new login so the next automatic invite can try again.
    if (isInvite) await createSupabaseServiceClient().auth.admin.deleteUser(link.userId);
    return { status: "failed" };
  }
  return { status: "sent", user_id: link.userId, type };
}

// Link an existing participants row to an auth user (called from /auth/callback
// after the invited user sets their password). Matches on lower(email).
// Returns the linked participant id, or null if no match.
//
// Conflict cases (multi-match: same email across multiple participant rows)
// are logged as account_claim_conflict and the link is NOT applied; admin
// must merge manually.
export async function claimParticipantByEmail(
  authUserId: string,
  email: string,
): Promise<{ status: "linked" | "no_match" | "conflict" | "already_linked"; participant_id?: string }> {
  const service = createSupabaseServiceClient();
  const normalised = email.trim().toLowerCase();

  // Is this auth_user_id already linked? Idempotency for double-clicks.
  const { data: existing } = await service
    .from("participants")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (existing) {
    return { status: "already_linked", participant_id: existing.id };
  }

  // Find unlinked candidates by email.
  const { data: candidates, error: candErr } = await service
    .from("participants")
    .select("id, email, auth_user_id")
    .ilike("email", normalised)
    .is("auth_user_id", null);
  if (candErr) {
    console.warn(`[claim] candidate query failed: ${candErr.message}`);
    return { status: "no_match" };
  }

  const matches = (candidates ?? []).filter(
    (c) => (c.email ?? "").trim().toLowerCase() === normalised,
  );

  if (matches.length === 0) {
    return { status: "no_match" };
  }
  if (matches.length > 1) {
    await writeAuditLog({
      actor_id: null,
      action: "participant.account_claim_conflict",
      entity: "participants",
      entity_id: matches[0].id,
      metadata: {
        email: normalised,
        candidate_ids: matches.map((m) => m.id),
        auth_user_id: authUserId,
      },
    });
    return { status: "conflict" };
  }

  const target = matches[0];
  const { error: updErr } = await service
    .from("participants")
    .update({ auth_user_id: authUserId })
    .eq("id", target.id)
    .is("auth_user_id", null); // optimistic guard
  if (updErr) {
    console.warn(`[claim] link failed: ${updErr.message}`);
    return { status: "no_match" };
  }

  await writeAuditLog({
    actor_id: null,
    action: "participant.account_claimed",
    entity: "participants",
    entity_id: target.id,
    metadata: { email: normalised, auth_user_id: authUserId },
  });

  return { status: "linked", participant_id: target.id };
}
