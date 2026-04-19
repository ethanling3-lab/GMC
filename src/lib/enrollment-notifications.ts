import "server-only";
import { createSupabaseServiceClient } from "./supabase";
import { sendEmail } from "./email";
import { sendWhatsAppTemplate } from "./whatsapp";

// Enrollment-state notifications. Called from the bulk + per-row admin
// routes whenever the journey stage changes. Follows the same bilingual
// email + WhatsApp-template + notifications-row pattern established in
// /api/register/route.ts so admin + CS have a single log to audit against.

type Locale = "zh" | "en";

type Participant = {
  id: string;
  name_en: string | null;
  name_cn: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
};

type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  currency: string | null;
};

type Enrollment = {
  id: string;
  event_id: string;
  participant_id: string;
  amount_paid: number | string | null;
  payment_method: string | null;
};

function pickLocale(participant: Participant): Locale {
  // The participants.language column may contain zh/en/other/free-text. Only
  // the first two map to a bilingual template — everything else falls back
  // to English for safety.
  return participant.language === "zh" ? "zh" : "en";
}

function participantName(p: Participant): string {
  return (p.name_en ?? p.name_cn ?? "").trim() || "Dear participant";
}

function eventTitle(e: EventRow, locale: Locale): string {
  return (
    (locale === "zh" ? e.title_cn : e.title_en) ||
    e.title_en ||
    e.title_cn ||
    e.slug
  );
}

function fmtAmount(
  amount: number | string | null,
  currency: string | null,
  locale: Locale,
): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-SG", {
      style: "currency",
      currency: currency ?? "SGD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency ?? "SGD"} ${n.toLocaleString()}`;
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

// --- Approval ---------------------------------------------------------------

export async function notifyApproved({
  enrollment,
  participant,
  event,
  paymentUrl,
  amountLabel,
}: {
  enrollment: Enrollment;
  participant: Participant;
  event: EventRow;
  paymentUrl: string;
  amountLabel: string;
}): Promise<void> {
  if (!participant.email && !participant.phone) return;
  const locale = pickLocale(participant);
  const name = participantName(participant);
  const title = eventTitle(event, locale);

  const subject =
    locale === "zh"
      ? `您的 GMC 报名已获批准 · 请完成付款`
      : `Your GMC registration is approved — complete payment`;

  const html = buildApprovedEmail({
    locale,
    name,
    eventTitle: title,
    amountLabel,
    paymentUrl,
  });

  const emailRes = participant.email
    ? await sendEmail({ to: participant.email, subject, html })
    : null;

  const waRes = participant.phone
    ? await sendWhatsAppTemplate({
        to: participant.phone,
        template: "gmc_enrollment_approved",
        languageCode: locale === "zh" ? "zh_CN" : "en_US",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: title },
              { type: "text", text: amountLabel },
              { type: "text", text: paymentUrl },
            ],
          },
        ],
      })
    : null;

  await logNotifications({
    participant_id: participant.id,
    enrollment_id: enrollment.id,
    event_id: event.id,
    email: { to: participant.email, template: "enrollment_approved", result: emailRes },
    whatsapp: {
      to: participant.phone,
      template: "gmc_enrollment_approved",
      result: waRes,
    },
  });
}

// --- Rejection --------------------------------------------------------------

export async function notifyRejected({
  enrollment,
  participant,
  event,
}: {
  enrollment: Enrollment;
  participant: Participant;
  event: EventRow;
}): Promise<void> {
  if (!participant.email && !participant.phone) return;
  const locale = pickLocale(participant);
  const name = participantName(participant);
  const title = eventTitle(event, locale);

  const subject =
    locale === "zh"
      ? `关于您的 GMC 报名 · 抱歉无法确认`
      : `Regarding your GMC registration`;

  const html = buildRejectedEmail({ locale, name, eventTitle: title });

  const emailRes = participant.email
    ? await sendEmail({ to: participant.email, subject, html })
    : null;

  const waRes = participant.phone
    ? await sendWhatsAppTemplate({
        to: participant.phone,
        template: "gmc_enrollment_rejected",
        languageCode: locale === "zh" ? "zh_CN" : "en_US",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: title },
            ],
          },
        ],
      })
    : null;

  await logNotifications({
    participant_id: participant.id,
    enrollment_id: enrollment.id,
    event_id: event.id,
    email: { to: participant.email, template: "enrollment_rejected", result: emailRes },
    whatsapp: {
      to: participant.phone,
      template: "gmc_enrollment_rejected",
      result: waRes,
    },
  });
}

// --- Payment received -------------------------------------------------------

export async function notifyPaymentReceived({
  enrollment,
  participant,
  event,
  amountLabel,
}: {
  enrollment: Enrollment;
  participant: Participant;
  event: EventRow;
  amountLabel: string;
}): Promise<void> {
  if (!participant.email && !participant.phone) return;
  const locale = pickLocale(participant);
  const name = participantName(participant);
  const title = eventTitle(event, locale);

  const subject =
    locale === "zh"
      ? `已收到您的付款 · GMC 报名确认`
      : `Payment received — GMC registration confirmed`;

  const html = buildPaymentReceivedEmail({
    locale,
    name,
    eventTitle: title,
    amountLabel,
    method: enrollment.payment_method,
  });

  const emailRes = participant.email
    ? await sendEmail({ to: participant.email, subject, html })
    : null;

  const waRes = participant.phone
    ? await sendWhatsAppTemplate({
        to: participant.phone,
        template: "gmc_payment_received",
        languageCode: locale === "zh" ? "zh_CN" : "en_US",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: title },
              { type: "text", text: amountLabel },
            ],
          },
        ],
      })
    : null;

  await logNotifications({
    participant_id: participant.id,
    enrollment_id: enrollment.id,
    event_id: event.id,
    email: { to: participant.email, template: "payment_received", result: emailRes },
    whatsapp: {
      to: participant.phone,
      template: "gmc_payment_received",
      result: waRes,
    },
  });
}

// --- Helpers ---------------------------------------------------------------

type DispatchRes = { mocked: boolean; id?: string; error?: string } | null;

async function logNotifications(params: {
  participant_id: string;
  enrollment_id: string;
  event_id: string;
  email: { to: string | null; template: string; result: DispatchRes };
  whatsapp: { to: string | null; template: string; result: DispatchRes };
}): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  if (params.email.to && params.email.result) {
    rows.push({
      participant_id: params.participant_id,
      enrollment_id: params.enrollment_id,
      event_id: params.event_id,
      channel: "email",
      template: params.email.template,
      to_address: params.email.to,
      status: params.email.result.mocked
        ? "pending"
        : params.email.result.error
          ? "failed"
          : "sent",
      provider_id: params.email.result.id ?? null,
      error_message: params.email.result.error ?? null,
      sent_at:
        params.email.result.mocked || params.email.result.error
          ? null
          : new Date().toISOString(),
    });
  }
  if (params.whatsapp.to && params.whatsapp.result) {
    rows.push({
      participant_id: params.participant_id,
      enrollment_id: params.enrollment_id,
      event_id: params.event_id,
      channel: "whatsapp",
      template: params.whatsapp.template,
      to_address: params.whatsapp.to,
      status: params.whatsapp.result.mocked
        ? "pending"
        : params.whatsapp.result.error
          ? "failed"
          : "sent",
      provider_id: params.whatsapp.result.id ?? null,
      error_message: params.whatsapp.result.error ?? null,
      sent_at:
        params.whatsapp.result.mocked || params.whatsapp.result.error
          ? null
          : new Date().toISOString(),
    });
  }
  if (rows.length === 0) return;
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      console.warn("[notify] log failed", error.code, error.message);
    }
  } catch (err) {
    console.warn("[notify] unexpected error", err);
  }
}

// --- Email templates -------------------------------------------------------
// Styled to match the existing confirmation email in /api/register/route.ts.

function emailShell(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px 16px;background:#F6F9FF;font-family:Georgia,serif;color:#0B2954;">
  <div style="max-width:560px;margin:0 auto;background:#FBFCFF;padding:48px 40px;border-radius:16px;box-shadow:0 2px 10px rgba(37,99,235,0.08);">
    <div style="display:inline-block;padding:10px 14px;border-radius:999px;background:#2563EB;color:#FBFCFF;font-weight:600;letter-spacing:0.04em;">GMC</div>
    ${inner}
    <hr style="border:none;border-top:1px solid #CEDAF0;margin:32px 0;">
    <p style="margin:0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#5A6B8A;">Glorious Melodies Consultancy · Singapore</p>
  </div>
</body></html>`;
}

function buildApprovedEmail({
  locale,
  name,
  eventTitle,
  amountLabel,
  paymentUrl,
}: {
  locale: Locale;
  name: string;
  eventTitle: string;
  amountLabel: string;
  paymentUrl: string;
}): string {
  const isZh = locale === "zh";
  const heading = isZh
    ? `${name}，您的报名已获批准`
    : `Dear ${name}, your registration is approved`;
  const body1 = isZh
    ? `欢迎加入「${eventTitle}」。请通过下方安全付款链接完成报名：`
    : `You're confirmed for <strong>${eventTitle}</strong>. Please complete payment via your personalised link:`;
  const body2 = isZh
    ? `应付金额 · <strong>${amountLabel}</strong>`
    : `Amount due · <strong>${amountLabel}</strong>`;
  const cta = isZh ? "打开付款页面" : "Open payment portal";
  const footer = isZh
    ? `如您已通过银行转账付款，请忽略此邮件 — 团队确认到账后会发送收据。`
    : `If you've already paid by bank transfer, you can ignore this — we'll send a receipt once the transfer is confirmed.`;
  return emailShell(`
    <h1 style="font-size:26px;line-height:1.25;margin:32px 0 16px;color:#0B2954;letter-spacing:-0.02em;">${heading}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 16px;color:#1E3A6B;">${body1}</p>
    <p style="font-size:15px;line-height:1.75;margin:0 0 24px;color:#1E3A6B;">${body2}</p>
    <a href="${paymentUrl}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#2563EB;color:#FBFCFF;text-decoration:none;letter-spacing:0.02em;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(37,99,235,0.28);">${cta}</a>
    <p style="margin:28px 0 0;font-size:12px;color:#5A6B8A;line-height:1.7;">${footer}</p>
  `);
}

function buildRejectedEmail({
  locale,
  name,
  eventTitle,
}: {
  locale: Locale;
  name: string;
  eventTitle: string;
}): string {
  const isZh = locale === "zh";
  const heading = isZh ? `${name}，您好：` : `Dear ${name},`;
  const body = isZh
    ? `非常感谢您对「${eventTitle}」的报名。很遗憾目前无法为您确认这次的参加名额。如对此有疑问或希望进一步了解，请随时回复此邮件或联系 GMC 客服。`
    : `Thank you for registering for <strong>${eventTitle}</strong>. We regret to inform you that we're unable to confirm your spot for this session. If you'd like to discuss further or explore future programmes, please reply to this email or reach out to the GMC team.`;
  const footer = isZh
    ? `期待未来与您再次相聚。`
    : `We look forward to welcoming you to a future programme.`;
  return emailShell(`
    <h1 style="font-size:26px;line-height:1.25;margin:32px 0 16px;color:#0B2954;letter-spacing:-0.02em;">${heading}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 24px;color:#1E3A6B;">${body}</p>
    <p style="margin:0;font-size:13px;color:#5A6B8A;line-height:1.7;">${footer}</p>
  `);
}

function buildPaymentReceivedEmail({
  locale,
  name,
  eventTitle,
  amountLabel,
  method,
}: {
  locale: Locale;
  name: string;
  eventTitle: string;
  amountLabel: string;
  method: string | null;
}): string {
  const isZh = locale === "zh";
  const heading = isZh ? `${name}，已收到您的付款` : `${name}, payment received`;
  const body1 = isZh
    ? `感谢您完成「${eventTitle}」的付款。您的报名已全部确认。`
    : `Thank you for completing payment for <strong>${eventTitle}</strong>. Your registration is fully confirmed.`;
  const line = isZh
    ? `金额 · <strong>${amountLabel}</strong>${method ? ` · 方式 · ${method}` : ""}`
    : `Amount · <strong>${amountLabel}</strong>${method ? ` · Method · ${method}` : ""}`;
  const footer = isZh
    ? `活动前一周我们将再次联系您，提供行程与其他细节。如有任何疑问请随时联系 GMC 团队。`
    : `We'll be in touch closer to the event with travel + logistics details. Reach out any time.`;
  return emailShell(`
    <h1 style="font-size:26px;line-height:1.25;margin:32px 0 16px;color:#0B2954;letter-spacing:-0.02em;">${heading}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 16px;color:#1E3A6B;">${body1}</p>
    <p style="font-size:15px;line-height:1.75;margin:0 0 24px;color:#1E3A6B;">${line}</p>
    <p style="margin:0;font-size:13px;color:#5A6B8A;line-height:1.7;">${footer}</p>
  `);
}

export function buildPaymentUrl(token: string): string {
  return `${baseUrl()}/pay/${token}`;
}

export { fmtAmount };
