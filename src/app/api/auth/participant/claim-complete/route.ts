import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { claimParticipantByEmail } from "@/lib/participant-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/claim-complete — called by the /auth/callback
// flow AFTER the user has set their password. Links the participants row
// to auth.uid() based on email match. Idempotent: if already linked,
// returns ok.
//
// Outcomes:
//   - linked: participants.auth_user_id = auth.uid() set; redirect to /me
//   - already_linked: no-op; redirect to /me
//   - conflict: multiple unlinked participants share this email; admin
//     must merge. Returns 409.
//   - no_match: no participants row with this email; surfaces to UI.
//     Returns 404.

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const result = await claimParticipantByEmail(user.id, user.email);
  if (result.status === "linked" || result.status === "already_linked") {
    return NextResponse.json({ ok: true, participant_id: result.participant_id });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }
  return NextResponse.json({ error: "no_match" }, { status: 404 });
}
