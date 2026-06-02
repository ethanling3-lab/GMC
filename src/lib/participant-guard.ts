import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

// Participant-side counterpart to requireAdmin(). Reads the Supabase Auth
// session, joins to `participants` via `auth_user_id`, redirects to
// /login if unauthenticated or unlinked. Returns the scoped read shape —
// the same scoped subset that lives in src/lib/participant-self.ts (kept
// minimal here; the full Self read happens via that helper).
//
// Note: the same auth.users row could in theory ALSO be in `admins` (if
// an admin signs up as a participant for personal use). That's fine —
// the guards check different tables. requireAdmin() looks at `admins`,
// requireParticipant() looks at `participants.auth_user_id`.

export type ParticipantContext = {
  id: string;
  auth_user_id: string;
  email: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  language_fluency: "en" | "cn" | "both" | null;
};

// Call from any /me/** Server Component. Redirects to /login if the user
// is unauthenticated OR authenticated but no participants row links to
// their auth.users.id.
export async function requireParticipant(nextPath?: string): Promise<ParticipantContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
    redirect(target);
  }

  // Use service-role for the participants lookup — RLS on `participants`
  // gates SELECT to admin roles, and we've already authenticated the user
  // via auth.getUser(). The defense-in-depth "participants can view
  // themselves" policy added in 041b also covers this, but service-role
  // makes the path explicit + bypasses any future RLS change.
  const service = createSupabaseServiceClient();
  const { data: participant, error } = await service
    .from("participants")
    .select("id, auth_user_id, region_id, name_en, name_cn, language_fluency")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !participant) {
    // Auth user exists but no participant row links to them. This is the
    // edge case where claim never completed — kick them back to /login with
    // a hint. We don't sign out (their session is valid) so they can retry
    // claim by typing email again.
    redirect("/login?reason=no_participant");
  }

  return {
    id: participant.id,
    auth_user_id: user.id,
    email: user.email ?? "",
    region_id: participant.region_id,
    name_en: participant.name_en,
    name_cn: participant.name_cn,
    language_fluency: participant.language_fluency,
  };
}
