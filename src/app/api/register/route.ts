import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { registrationSchema } from "@/lib/validation";
import { createToken } from "@/lib/tokens";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { sendWhatsAppTemplate, isWhatsAppConfigured } from "@/lib/whatsapp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const supabase = createSupabaseServiceClient();

  // 1) Find the event by slug, ensure it's accepting registrations.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, status, requires_approval, enrollment_closes_at, capacity")
    .eq("slug", input.event_slug)
    .maybeSingle();

  if (eventErr || !event) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }
  if (event.status !== "open") {
    return NextResponse.json({ error: "event_not_open" }, { status: 409 });
  }

  // 2) Upsert participant by (email, phone).
  //    The region_id trigger auto-assigns MY001 / SG001 / etc. on first insert.
  const participantPayload = {
    name_cn: input.name_cn || null,
    name_en: input.name_en,
    email: input.email,
    phone: input.phone,
    region: input.region,
    language: input.language,
    gender: input.gender,
    birth_date: input.birth_date || null,
    occupation: input.occupation || null,
    industry: input.industry || null,
    status: "new" as const,
  };

  // Try to find an existing participant match
  const { data: existing } = await supabase
    .from("participants")
    .select("id, region_id")
    .eq("email", input.email)
    .eq("phone", input.phone)
    .maybeSingle();

  let participantId: string;
  let regionId: string | null = null;

  if (existing) {
    participantId = existing.id;
    regionId = existing.region_id;
    // Update with latest details (but don't overwrite status if already further along)
    await supabase.from("participants").update(participantPayload).eq("id", existing.id);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("participants")
      .insert(participantPayload)
      .select("id, region_id")
      .single();
    if (insertErr || !inserted) {
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
    participantId = inserted.id;
    regionId = inserted.region_id;
  }

  // 3) Check duplicate enrollment, then insert.
  const { data: existingEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("participant_id", participantId)
    .eq("event_id", event.id)
    .maybeSingle();

  if (existingEnrollment) {
    return NextResponse.json({ error: "already_enrolled" }, { status: 409 });
  }

  const confirmationToken = createToken("confirm_registration", `${participantId}:${event.id}`);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const { data: enrollment, error: enrollErr } = await supabase
    .from("enrollments")
    .insert({
      participant_id: participantId,
      event_id: event.id,
      status: event.requires_approval ? "pending_approval" : "approved",
      confirmation_token: confirmationToken,
      confirmation_token_expires_at: expiresAt,
    })
    .select("id, status")
    .single();

  if (enrollErr || !enrollment) {
    return NextResponse.json({ error: "enroll_failed" }, { status: 500 });
  }

  // 4) Record the referrer note in the CS notes field so CS can follow up.
  const referralNote = [
    `Referrer: ${input.referrer_name}`,
    input.referrer_contact ? `Contact: ${input.referrer_contact}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  await supabase
    .from("enrollments")
    .update({ cs_followup_notes: referralNote })
    .eq("id", enrollment.id);

  // 5) Fire off confirmation notifications (email + WhatsApp). Mocked if creds absent.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const confirmUrl = `${baseUrl}/confirm/${confirmationToken}`;

  const emailRes = await sendEmail({
    to: input.email,
    subject: input.language === "en" ? "Please confirm your GMC registration" : "请核对你的 GMC 报名信息",
    html: buildConfirmationEmail({
      locale: input.language === "en" ? "en" : "zh",
      name: input.name_en,
      confirmUrl,
    }),
  });

  const waRes = await sendWhatsAppTemplate({
    to: input.phone,
    template: "gmc_confirm_registration",
    languageCode: input.language === "en" ? "en_US" : "zh_CN",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: input.name_en },
          { type: "text", text: confirmUrl },
        ],
      },
    ],
  });

  await supabase.from("notifications").insert([
    {
      participant_id: participantId,
      enrollment_id: enrollment.id,
      event_id: event.id,
      channel: "email",
      template: "confirm_registration",
      to_address: input.email,
      status: emailRes.mocked ? "pending" : emailRes.error ? "failed" : "sent",
      provider_id: emailRes.id ?? null,
      error_message: emailRes.error ?? null,
      sent_at: emailRes.mocked || emailRes.error ? null : new Date().toISOString(),
    },
    {
      participant_id: participantId,
      enrollment_id: enrollment.id,
      event_id: event.id,
      channel: "whatsapp",
      template: "gmc_confirm_registration",
      to_address: input.phone,
      status: waRes.mocked ? "pending" : waRes.error ? "failed" : "sent",
      provider_id: waRes.id ?? null,
      error_message: waRes.error ?? null,
      sent_at: waRes.mocked || waRes.error ? null : new Date().toISOString(),
    },
  ]);

  return NextResponse.json({
    success: true,
    region_id: regionId,
    delivery: {
      email: emailRes.mocked ? "mocked" : emailRes.error ? "failed" : "sent",
      whatsapp: waRes.mocked ? "mocked" : waRes.error ? "failed" : "sent",
    },
    // Only exposed in development so developers can manually click-through during testing.
    // In production the link only reaches the participant.
    ...(process.env.NODE_ENV === "development"
      ? { dev_confirm_url: confirmUrl }
      : {}),
  });
}

function buildConfirmationEmail({
  locale,
  name,
  confirmUrl,
}: {
  locale: "zh" | "en";
  name: string;
  confirmUrl: string;
}): string {
  const isZh = locale === "zh";
  const greeting = isZh ? `${name}，你好：` : `Dear ${name},`;
  const body = isZh
    ? `感谢你报名参加 GMC 的课程。请点击以下链接核对你的个人信息：`
    : `Thank you for registering for a GMC programme. Please confirm your details using the link below:`;
  const footer = isZh
    ? `如链接无法点击，请直接复制到浏览器打开。<br>如有任何问题，请联系 GMC 客服。`
    : `If the link doesn't work, copy and paste it into your browser.<br>For any questions, please contact the GMC team.`;
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px 16px;background:#F7F2E7;font-family:Georgia,serif;color:#14110F;">
  <div style="max-width:560px;margin:0 auto;background:#FBF7EE;padding:48px 40px;box-shadow:0 2px 8px rgba(139,42,28,0.05);">
    <div style="display:inline-block;padding:10px 14px;background:#8B2A1C;color:#FBF7EE;font-weight:700;letter-spacing:0.04em;transform:rotate(-4deg);">GMC</div>
    <h1 style="font-size:28px;line-height:1.2;margin:32px 0 16px;color:#14110F;letter-spacing:-0.02em;">${greeting}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 28px;color:#3A332E;">${body}</p>
    <a href="${confirmUrl}" style="display:inline-block;padding:14px 28px;background:#14110F;color:#FBF7EE;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-size:12px;font-weight:600;">${isZh ? "核对信息" : "Confirm details"}</a>
    <p style="margin:28px 0 0;font-size:12px;color:#7A6F66;line-height:1.7;">${footer}</p>
    <hr style="border:none;border-top:1px solid #D9CFB7;margin:32px 0;">
    <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7A6F66;">Glorious Melodies Consultancy · Singapore</p>
  </div>
</body></html>`;
}
