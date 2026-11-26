import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import { sendEmail } from "../email";
import { participantEmailLocale } from "../i18n";
import { buildCheckInUrl } from "../check-in/qr-token";
import { findTemplate } from "../inbox/whatsapp-templates";
import { normalizePhone } from "../whatsapp/phone";
import { withGuardianContact } from "../participants/children";
import { sendWhatsAppTemplate } from "../whatsapp";

// M7.2 reminder dispatcher. Sends a single bilingual email to a paid
// participant ahead of their event, embedding the same /checkin/<token>
// CTA we put in the payment-received receipt. The notifications table is
// the idempotency log — see hasReminderBeenSent() below.
//
// WhatsApp: outside Meta's 24-hour window only an approved template may be
// sent, so the 48h WhatsApp reminder starts by itself once
// `gmc_event_reminder_48h` is approved on Meta, and does nothing until then.

type Locale = "zh" | "en";

export type ReminderWindow = "48h" | "24h";

export type ReminderInput = {
  enrollment: {
    id: string;
    event_id: string;
    participant_id: string;
    qr_token: string | null;
  };
  participant: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
    email: string | null;
    phone: string | null;
    language_fluency: string | null;
  };
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    venue: string | null;
    city: string | null;
  };
  window: ReminderWindow;
};

export type ReminderResult =
  | { ok: true; sent: boolean; reason?: never }
  | { ok: false; reason: "no_email" | "no_qr_token" | "send_failed"; detail?: string };

export function templateNameForReminder(
  window: ReminderWindow,
  channel: "email" | "whatsapp",
): string {
  return `event_reminder_${window}_${channel}`;
}

// Returns true if we've already attempted to send this reminder for this
// enrollment in this channel — regardless of whether the prior attempt
// succeeded. The cron treats any prior attempt as "tried" so a transient
// outage doesn't re-bombard participants the next hour; admin can resend
// manually via the inbox / enrollments console if needed.
export async function hasReminderBeenSent(
  enrollmentId: string,
  window: ReminderWindow,
  channel: "email" | "whatsapp",
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("enrollment_id", enrollmentId)
    .eq("channel", channel)
    .eq("template", templateNameForReminder(window, channel))
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail safe: assume it hasn't been sent so we retry rather than silently
    // skip. The unique-template + channel pair in notifications doesn't have
    // a real DB constraint so duplicates are still possible — that's
    // accepted as the cost of preferring delivery over strict dedup.
    console.warn("[reminders] dedup query failed", error.code, error.message);
    return false;
  }
  return Boolean(data);
}

function pickLocale(p: ReminderInput["participant"]): Locale {
  return participantEmailLocale(p);
}

function participantName(p: ReminderInput["participant"]): string {
  return (p.name_en ?? p.name_cn ?? "").trim() || "Dear participant";
}

function eventTitle(e: ReminderInput["event"], locale: Locale): string {
  return (
    (locale === "zh" ? e.title_cn : e.title_en) ||
    e.title_en ||
    e.title_cn ||
    e.slug
  );
}

function formatEventDate(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(
      locale === "zh" ? "zh-CN" : "en-SG",
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );
  } catch {
    return iso;
  }
}

export async function sendEventReminder(
  input: ReminderInput,
): Promise<ReminderResult> {
  const { enrollment, event, window } = input;
  // A child has no own contact: remind their parent (migration 084).
  const participant = await withGuardianContact({ region: null, ...input.participant });

  if (!participant.email) {
    return { ok: false, reason: "no_email" };
  }
  if (!enrollment.qr_token) {
    // Defense in depth — the cron loader filters by qr_token IS NOT NULL,
    // but we double-check so a hand-triggered call can't slip a reminder
    // without a working check-in URL.
    return { ok: false, reason: "no_qr_token" };
  }

  const locale = pickLocale(participant);
  const name = participantName(participant);
  const title = eventTitle(event, locale);
  const dateLabel = formatEventDate(event.start_date, locale);
  const venueLine = [event.venue, event.city].filter(Boolean).join(" · ");
  const checkInUrl = buildCheckInUrl(enrollment.qr_token);

  const subject =
    window === "48h"
      ? locale === "zh"
        ? `还有 2 天 · 您即将参加 ${title}`
        : `2 days to go — ${title}`
      : locale === "zh"
        ? `明天见 · ${title}`
        : `See you tomorrow — ${title}`;

  const html = buildReminderEmail({
    locale,
    name,
    eventTitle: title,
    dateLabel,
    venueLine,
    checkInUrl,
    window,
  });

  const result = await sendEmail({
    to: participant.email,
    subject,
    html,
  });

  await logReminder({
    enrollment_id: enrollment.id,
    event_id: event.id,
    participant_id: participant.id,
    channel: "email",
    template: templateNameForReminder(window, "email"),
    to: participant.email,
    result,
  });

  if (result?.error) {
    return { ok: false, reason: "send_failed", detail: result.error };
  }
  return { ok: true, sent: true };
}

const WA_REMINDER_TEMPLATE = "gmc_event_reminder_48h";

/** The 48-hour WhatsApp reminder. False when nothing was attempted. */
export async function sendWhatsAppReminder(
  input: ReminderInput & { participant: ReminderInput["participant"] & { region?: string | null } },
): Promise<boolean> {
  const { enrollment, participant, event, window } = input;
  if (window !== "48h" || !enrollment.qr_token) return false;

  // Not approved yet: leave no log row, so it can send once it is.
  const def = await findTemplate(WA_REMINDER_TEMPLATE).catch(() => undefined);
  const locale = pickLocale(participant);
  const language = locale === "zh" ? "zh_CN" : "en_US";
  if (!def || def.params.length !== 5 || !def.languages.includes(language)) return false;

  const phone = normalizePhone(participant.phone, participant.region);
  if (!phone.ok) return false;

  const venue = [event.venue, event.city].filter(Boolean).join(", ") || "—";
  const result = await sendWhatsAppTemplate({
    to: phone.e164,
    template: WA_REMINDER_TEMPLATE,
    languageCode: def.meta_language_by_language?.[language] ?? language,
    components: [
      {
        type: "body",
        parameters: [
          participantName(participant),
          eventTitle(event, locale),
          formatEventDate(event.start_date, locale),
          venue,
          buildCheckInUrl(enrollment.qr_token),
        ].map((text) => ({ type: "text" as const, text })),
      },
    ],
  });

  await logReminder({
    enrollment_id: enrollment.id,
    event_id: event.id,
    participant_id: participant.id,
    channel: "whatsapp",
    template: templateNameForReminder(window, "whatsapp"),
    to: phone.e164,
    result,
  });
  return true;
}

type SendEmailResult = { mocked?: boolean; id?: string; error?: string };

async function logReminder(params: {
  enrollment_id: string;
  event_id: string;
  participant_id: string;
  channel: "email" | "whatsapp";
  template: string;
  to: string;
  result: SendEmailResult;
}): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("notifications").insert({
      participant_id: params.participant_id,
      enrollment_id: params.enrollment_id,
      event_id: params.event_id,
      channel: params.channel,
      template: params.template,
      to_address: params.to,
      status: params.result?.mocked
        ? "pending"
        : params.result?.error
          ? "failed"
          : "sent",
      provider_id: params.result?.id ?? null,
      error_message: params.result?.error ?? null,
      sent_at:
        params.result?.mocked || params.result?.error
          ? null
          : new Date().toISOString(),
    });
    if (error) {
      console.warn("[reminders] log failed", error.code, error.message);
    }
  } catch (err) {
    console.warn("[reminders] unexpected log error", err);
  }
}

// -- Email template ----------------------------------------------------------

function buildReminderEmail({
  locale,
  name,
  eventTitle,
  dateLabel,
  venueLine,
  checkInUrl,
  window,
}: {
  locale: Locale;
  name: string;
  eventTitle: string;
  dateLabel: string;
  venueLine: string;
  checkInUrl: string;
  window: ReminderWindow;
}): string {
  const isZh = locale === "zh";
  const heading = isZh
    ? window === "48h"
      ? `${name}，活动还有 2 天`
      : `${name}，明天见`
    : window === "48h"
      ? `${name}, your event is in 2 days`
      : `${name}, see you tomorrow`;

  const intro = isZh
    ? `这是「${eventTitle}」的温馨提醒。期待与您相聚。`
    : `A friendly reminder for <strong>${eventTitle}</strong>. We look forward to welcoming you.`;

  const dateRow = isZh ? `日期 · ${dateLabel}` : `Date · ${dateLabel}`;
  const venueRow = venueLine
    ? isZh
      ? `地点 · ${venueLine}`
      : `Venue · ${venueLine}`
    : null;

  const ctaLabel = isZh ? "打开我的签到二维码" : "Open my check-in QR";
  const ctaHint = isZh
    ? `活动当天请出示下方二维码完成签到，建议提前保存截图。`
    : `Show this QR at the entrance on the day of the event. Save a screenshot ahead of time.`;

  const footer = isZh
    ? `如有任何变动，请随时回复此邮件联系 GMC 团队。`
    : `If anything changes on your end, just reply to this email — the GMC team will follow up.`;

  return emailShell(`
    <h1 style="font-size:26px;line-height:1.25;margin:32px 0 16px;color:#0B2954;letter-spacing:-0.02em;">${heading}</h1>
    <p style="font-size:15px;line-height:1.75;margin:0 0 18px;color:#1E3A6B;">${intro}</p>
    <div style="margin:0 0 24px;padding:16px 20px;border-radius:14px;background:#F4F1EA;border:1px solid #E3DCC8;color:#1E3A6B;font-size:14px;line-height:1.7;">
      <div>${dateRow}</div>
      ${venueRow ? `<div style="margin-top:4px;">${venueRow}</div>` : ""}
    </div>
    <div style="margin:0 0 8px;font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#C84B3B;">${isZh ? "活动当天签到 · Check-in" : "Event-day check-in · 签到"}</div>
    <a href="${checkInUrl}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#0B2954;color:#FBFCFF;text-decoration:none;letter-spacing:0.04em;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(11,41,84,0.18);">${ctaLabel}</a>
    <p style="margin:14px 0 0;font-size:12.5px;color:#5A6B8A;line-height:1.7;">${ctaHint}</p>
    <p style="margin:28px 0 0;font-size:12.5px;color:#5A6B8A;line-height:1.7;">${footer}</p>
  `);
}

function emailShell(inner: string): string {
  // Mirrors src/lib/enrollment-notifications.ts → emailShell so reminder
  // emails feel like part of the same family as approval + receipt mail.
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
