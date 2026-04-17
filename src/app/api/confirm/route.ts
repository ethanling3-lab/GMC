import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { confirmationSchema } from "@/lib/validation";
import { verifyToken } from "@/lib/tokens";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = confirmationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const supabase = createSupabaseServiceClient();

  // Look up enrollment by confirmation token
  const { data: enrollment, error: enrollErr } = await supabase
    .from("enrollments")
    .select("id, participant_id, event_id, confirmation_token_expires_at, confirmed_at")
    .eq("confirmation_token", input.token)
    .maybeSingle();

  if (enrollErr || !enrollment) {
    return NextResponse.json({ error: "token_invalid" }, { status: 404 });
  }

  // Verify HMAC (defense in depth alongside the DB lookup)
  if (!verifyToken("confirm_registration", `${enrollment.participant_id}:${enrollment.event_id}`, input.token)) {
    return NextResponse.json({ error: "token_invalid" }, { status: 404 });
  }

  // Check expiry
  if (enrollment.confirmation_token_expires_at && new Date(enrollment.confirmation_token_expires_at) < new Date()) {
    return NextResponse.json({ error: "token_expired" }, { status: 410 });
  }

  // Apply updates to the participant
  const { error: updateErr } = await supabase
    .from("participants")
    .update({
      name_cn: input.name_cn || null,
      name_en: input.name_en,
      email: input.email,
      phone: input.phone,
      region: input.region,
      occupation: input.occupation || null,
      industry: input.industry || null,
      status: "info_verified",
    })
    .eq("id", enrollment.participant_id);

  if (updateErr) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // Mark enrollment confirmed (but don't clear the token — makes the page idempotent)
  await supabase
    .from("enrollments")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", enrollment.id);

  return NextResponse.json({ success: true });
}
