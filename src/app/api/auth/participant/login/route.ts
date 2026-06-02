import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/login — email + password sign-in for
// participants. Mirrors the admin login at /api/admin/auth/login but
// gates on participants.auth_user_id instead of admins.id.

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Gate: must be linked to a participants row. Use service-role because
  // `participants` SELECT is RLS-gated to admin roles; the participant
  // hasn't yet been recognised as a participant by us.
  const service = createSupabaseServiceClient();
  const { data: participant } = await service
    .from("participants")
    .select("id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!participant) {
    // Signed in to auth but not linked yet. Sign them out so they retry
    // via the set-up-account flow.
    await supabase.auth.signOut();
    return NextResponse.json({ error: "not_linked" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
