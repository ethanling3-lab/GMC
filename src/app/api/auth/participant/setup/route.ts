import { NextResponse } from "next/server";
import { z } from "zod";
import { claimParticipantByEmail } from "@/lib/participant-invite";
import { safeMemberNext } from "@/lib/auth/safe-next";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/setup: spends a one-time link, links the login to
// the student record, then sets the password.

const Body = z.object({
  token: z.string().min(16).max(256),
  type: z.enum(["invite", "recovery"]),
  password: z.string().min(8).max(200),
  /** Where a member lands afterwards, e.g. the event they signed up for. */
  next: z.string().max(300).optional(),
});

const EXPIRED =
  "This link has expired or was already used. Request a new one on the sign-in page. 此链接已过期或已使用，请在登录页面重新申请。";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", detail: "Password must be at least 8 characters. 密码至少需要 8 个字符。" },
      { status: 400 },
    );
  }
  const { token, type, password, next } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type });
  if (error || !data.user?.email) {
    return NextResponse.json({ error: "link_expired", detail: EXPIRED }, { status: 400 });
  }

  const claim = await claimParticipantByEmail(data.user.id, data.user.email);
  let redirect = safeMemberNext(next);
  if (claim.status === "conflict") {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error: "conflict",
        detail: "We found more than one student record for this email. Please contact support so we can merge them. 此邮箱对应多个学员记录，请联系客服处理。",
      },
      { status: 409 },
    );
  }
  if (claim.status === "no_match") {
    // Staff can use the same forgot-password page.
    const { data: admin } = await createSupabaseServiceClient()
      .from("admins")
      .select("id")
      .eq("id", data.user.id)
      .is("deactivated_at", null)
      .maybeSingle();
    if (!admin) {
      await supabase.auth.signOut();
      return NextResponse.json(
        {
          error: "no_match",
          detail: "We couldn't find a student record for this email. Please contact support. 未找到此邮箱的学员记录，请联系客服。",
        },
        { status: 404 },
      );
    }
    redirect = "/admin";
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error: "password_rejected",
        detail: `${updateError.message} Request a new link on the sign-in page and choose a different password.`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, redirect });
}
