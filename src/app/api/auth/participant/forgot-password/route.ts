import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/forgot-password — sends a password-reset
// email via Supabase Auth. Email-enumeration safe: same generic response
// whether or not the email exists.

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const redirectTo = `${siteUrl.replace(/\/$/, "")}/reset-password`;

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });
  if (error) {
    // Log but still return generic OK.
    console.warn(`[forgot-password] ${parsed.data.email}: ${error.message}`);
  } else {
    await writeAuditLog({
      actor_id: null,
      action: "participant.password_reset_requested",
      entity: "auth",
      entity_id: parsed.data.email,
      metadata: { email: parsed.data.email },
    });
  }

  return NextResponse.json({
    ok: true,
    message: "If your email is in our system, you'll get a reset link shortly.",
  });
}
