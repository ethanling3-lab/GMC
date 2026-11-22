import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/staff-setup: uses a one-time staff link to set a password.
// The token is only spent here, so opening the link never uses it up.

const Body = z.object({
  token: z.string().min(16).max(256),
  type: z.enum(["invite", "recovery"]),
  password: z.string().min(8).max(200),
});

const EXPIRED = "This link has expired or was already used. Ask your admin for a new one.";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", detail: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  const { token, type, password } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type });
  if (error || !data.user) {
    return NextResponse.json({ error: "link_expired", detail: EXPIRED }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: admin } = await service
    .from("admins")
    .select("id")
    .eq("id", data.user.id)
    .is("deactivated_at", null)
    .maybeSingle();
  if (!admin) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "not_staff", detail: "This account doesn't have staff access." },
      { status: 403 },
    );
  }

  // Update through their own session: an admin-side change would end the session
  // that was just created and send them back to the sign-in page.
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error: "password_rejected",
        detail: `${updateError.message} Ask your admin for a new link and choose a different password.`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, redirect: "/admin" });
}
