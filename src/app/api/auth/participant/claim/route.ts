import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { sendParticipantAccountLink } from "@/lib/participant-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/claim — handles the /login set-up-account
// path. Takes an email; if it matches an existing participants row that
// has no auth_user_id yet, emails a one-time link to /auth/account where
// they set a password and their login is linked to the record.
//
// Email-enumeration safe: response is identical regardless of whether
// the email matched, was already linked, or was unknown. Internally we
// log the actual outcome so admin can debug.

const claimSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { email } = parsed.data;
  const service = createSupabaseServiceClient();

  const { data: candidates } = await service
    .from("participants")
    .select("id, email, auth_user_id, region_id, name_en, name_cn")
    .ilike("email", email);
  const matches = (candidates ?? []).filter(
    (c) => (c.email ?? "").trim().toLowerCase() === email,
  );

  const unlinked = matches.filter((m) => !m.auth_user_id);
  const alreadyLinked = matches.length > 0 && unlinked.length === 0;

  // Three outcomes — all return the same generic 200 to the client.
  if (unlinked.length >= 1) {
    // Fire the invite. If multiple unlinked participants share this email,
    // we still fire — the /auth/account claim logic handles the conflict
    // case by flagging account_claim_conflict.
    const sent = await sendParticipantAccountLink(
      email,
      unlinked[0].name_en || unlinked[0].name_cn || "",
    );
    if (sent.status === "sent") {
      await writeAuditLog({
        actor_id: null,
        action: "participant.account_invite_sent",
        entity: "participants",
        entity_id: unlinked[0].id,
        metadata: {
          via: "self_claim",
          region_id: unlinked[0].region_id,
          auth_user_id: sent.user_id,
          conflict_candidates: unlinked.length > 1 ? unlinked.map((u) => u.id) : null,
        },
      });
    } else {
      console.warn(`[claim] link not sent: ${sent.status}`);
    }
  } else if (alreadyLinked) {
    console.info("[claim] email already has an account; no-op");
  } else {
    console.info("[claim] no participant match; no-op");
  }

  // Always return the same generic message so the response can't be used
  // to enumerate emails.
  return NextResponse.json({
    ok: true,
    message: "If your email is in our system, you'll get a setup link shortly.",
  });
}
