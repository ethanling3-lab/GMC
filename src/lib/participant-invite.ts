import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

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
// Uses supabase.auth.admin.inviteUserByEmail which sends an "Invite user"
// email via Supabase Auth's configured SMTP (Resend, per Phase 2.5 ops
// task). The email contains a link to /auth/callback?claim=1 where the
// participant sets their password.

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
    .select("id, email, auth_user_id, region_id")
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const redirectTo = `${siteUrl.replace(/\/$/, "")}/auth/callback?claim=1`;

  const { data: invitedUser, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    participant.email,
    { redirectTo },
  );

  if (inviteErr) {
    // Supabase returns user_already_exists if the email already has an
    // auth.users row (e.g. they previously claimed under a different
    // participant row, or they have an admins entry). In that case skip
    // — they can self-claim via /login set-up-account mode if they need
    // to re-link.
    const msg = inviteErr.message ?? "invite failed";
    if (msg.toLowerCase().includes("already")) {
      return { status: "skipped", reason: "already_linked" };
    }
    console.warn(`[participant-invite] inviteUserByEmail failed (via=${via}): ${msg}`);
    return { status: "error", message: msg };
  }

  await writeAuditLog({
    actor_id: null,
    action: "participant.account_invite_sent",
    entity: "participants",
    entity_id: participant.id,
    metadata: {
      via,
      email: participant.email,
      region_id: participant.region_id,
      auth_user_id: invitedUser?.user?.id ?? null,
    },
  });

  return { status: "sent", user_id: invitedUser?.user?.id ?? "" };
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
