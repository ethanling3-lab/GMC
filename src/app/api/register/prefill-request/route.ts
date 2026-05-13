import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { createPrefillToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

// Privacy-safe returning-participant lookup. The response is always 204
// regardless of whether the email matches a participant — we never leak
// existence. If it does match, we email a single-use "quick fill" link that
// encodes the participant id + a 20-minute expiry in the HMAC.

const PREFILL_TTL_MS = 20 * 60 * 1000;

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  event_slug: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Still return 204 — don't surface details.
    return new NextResponse(null, { status: 204 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  const { email, event_slug } = parsed.data;
  const supabase = createSupabaseServiceClient();

  const { data: participant } = await supabase
    .from("participants")
    .select("id, name_en, name_cn, language_fluency")
    .eq("email", email)
    .maybeSingle();

  if (!participant) return new NextResponse(null, { status: 204 });

  const token = createPrefillToken(participant.id, PREFILL_TTL_MS);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const params = new URLSearchParams();
  params.set("prefill", token);
  if (event_slug) params.set("event", event_slug);
  const link = `${baseUrl}/register?${params.toString()}`;

  const locale =
    participant.language_fluency === "cn" || participant.language_fluency === "both"
      ? "zh"
      : "en";
  const displayName = participant.name_en || participant.name_cn || "";

  const emailRes = await sendEmail({
    to: email,
    subject:
      locale === "en"
        ? "Your quick-fill registration link"
        : "您的快速填入报名链接",
    html: buildPrefillEmail({ locale, name: displayName, link }),
  });

  await supabase.from("notifications").insert({
    participant_id: participant.id,
    channel: "email",
    template: "register_prefill",
    to_address: email,
    status: emailRes.mocked ? "pending" : emailRes.error ? "failed" : "sent",
    provider_id: emailRes.id ?? null,
    error_message: emailRes.error ?? null,
    sent_at:
      emailRes.mocked || emailRes.error ? null : new Date().toISOString(),
  });

  // In development, expose the link in the response so engineers can test
  // without needing SMTP. Never expose in production.
  if (process.env.NODE_ENV === "development") {
    return NextResponse.json({ ok: true, dev_prefill_url: link });
  }
  return new NextResponse(null, { status: 204 });
}

function buildPrefillEmail({
  locale,
  name,
  link,
}: {
  locale: "zh" | "en";
  name: string;
  link: string;
}): string {
  const isZh = locale === "zh";
  const greeting = isZh ? `${name}，你好：` : `Dear ${name},`;
  const body = isZh
    ? `以下是您的「快速填入」链接（20 分钟内有效）。点击后将自动为您填入上次登记的信息，您只需补充本次活动新增的问题。`
    : `Your one-time quick-fill link is below (valid for 20 minutes). Opening it will auto-fill the identity section with your previously submitted information, leaving you to answer only the new questions for this event.`;
  const footer = isZh
    ? `如您没有申请此链接，可忽略此邮件——无需进一步操作。`
    : `If you didn't request this link, you can safely ignore this email — no action is required.`;
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px 16px;background:#F6F9FF;font-family:Georgia,serif;color:#0B2954;">
  <div style="max-width:560px;margin:0 auto;background:#FBFCFF;padding:48px 40px;border-radius:16px;box-shadow:0 2px 10px rgba(37,99,235,0.08);">
    <div style="display:inline-block;padding:10px 14px;border-radius:999px;background:#2563EB;color:#FBFCFF;font-weight:600;letter-spacing:0.04em;">GMC</div>
    <h1 style="font-size:26px;line-height:1.25;margin:32px 0 16px;color:#0B2954;letter-spacing:-0.02em;">${greeting}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 28px;color:#1E3A6B;">${body}</p>
    <a href="${link}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#2563EB;color:#FBFCFF;text-decoration:none;letter-spacing:0.02em;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(37,99,235,0.28);">${isZh ? "开始快速填入" : "Open quick-fill"}</a>
    <p style="margin:28px 0 0;font-size:12px;color:#5A6B8A;line-height:1.7;">${footer}</p>
    <hr style="border:none;border-top:1px solid #CEDAF0;margin:32px 0;">
    <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#5A6B8A;">Glorious Melodies Consultancy · Singapore</p>
  </div>
</body></html>`;
}
