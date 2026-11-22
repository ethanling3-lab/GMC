import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { buildPaymentUrl, fmtAmount } from "@/lib/enrollment-notifications";
import { participantEmailLocale } from "@/lib/i18n";
import { findOrCreateConversationForBroadcast } from "@/lib/broadcasts/conversation-resolve";
import { sendOutboundMessage, type SendOutboundResult } from "@/lib/inbox/send";
import { findTemplate } from "@/lib/inbox/whatsapp-templates";
import { enrollmentAmountDue } from "@/lib/pricing/tiers";
import { createPaymentAccessToken } from "@/lib/tokens";
import { loadWhatsAppAutomations } from "./automations";
import { normalizePhone } from "./phone";

// One automatic WhatsApp reminder for people who were approved but haven't
// paid. Reuses the Meta-approved payment template, so it works outside the
// 24-hour window. It is a notice about their own registration, so it doesn't
// depend on marketing consent.
//
// Safety rules:
//   - off unless an admin turned it on
//   - only people approved after it was turned on
//   - at most one per registration (claimed before sending)
//   - only 9am to 8pm Singapore time, and at most MAX_PER_RUN per hourly run

const TEMPLATE = "gmc_enrollment_approved";
const NOTIFICATION_TEMPLATE = "payment_followup_whatsapp";
const TZ = "Asia/Singapore";
const MAX_PER_RUN = 50;
const PAYMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  event_id: string;
  participant_id: string;
  amount_due: number | string | null;
  participant: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
    phone: string | null;
    region: string | null;
    language_fluency: string | null;
    archived_at: string | null;
  } | null;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    status: string;
    currency: string | null;
    price: number | string | null;
  } | null;
};

export type FollowupSummary = {
  ran: boolean;
  reason: string | null;
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
};

function localParts(now: Date): { hour: number; day: string } {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now),
  );
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  return { hour: hour % 24, day };
}

export async function runPaymentFollowups(now: Date = new Date()): Promise<FollowupSummary> {
  const summary: FollowupSummary = { ran: false, reason: null, scanned: 0, sent: 0, failed: 0, skipped: 0 };
  const stop = (reason: string) => ({ ...summary, reason });

  const service = createSupabaseServiceClient();
  const settings = await loadWhatsAppAutomations(service);
  if (!settings?.followup_enabled || !settings.followup_enabled_at) return stop("off");

  const { hour, day } = localParts(now);
  if (hour < 9 || hour >= 20) return stop("quiet_hours");

  // Checked before anything is claimed, so an unavailable template delays
  // reminders rather than using up each person's only one.
  const template = await findTemplate(TEMPLATE);
  if (!template) return stop("template_unavailable");

  // Messages in the thread need an admin as sender: whoever last saved settings.
  const { data: owner } = await service
    .from("whatsapp_automations")
    .select("updated_by")
    .eq("id", true)
    .maybeSingle();
  const senderAdminId = (owner?.updated_by as string | null) ?? null;
  if (!senderAdminId) return stop("no_sender");

  const cutoff = new Date(now.getTime() - settings.followup_after_days * DAY_MS).toISOString();
  const { data, error } = await service
    .from("enrollments")
    .select(
      "id, event_id, participant_id, amount_due, " +
        "participant:participants!inner(id, name_en, name_cn, phone, region, language_fluency, archived_at), " +
        "event:events!inner(id, slug, title_en, title_cn, start_date, status, currency, price)",
    )
    .eq("status", "approved")
    .in("payment_status", ["none", "pending", "failed"])
    .is("payment_followup_sent_at", null)
    .gte("approved_at", settings.followup_enabled_at)
    .lte("approved_at", cutoff)
    .order("approved_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(`followups: load failed: ${error.message}`);

  summary.ran = true;
  for (const row of (data ?? []) as unknown as Row[]) {
    summary.scanned += 1;
    const { participant, event } = row;
    if (!participant || !event || participant.archived_at) {
      summary.skipped += 1;
      continue;
    }
    // Past or closed events: a payment nudge would be wrong.
    if (event.status !== "open" || !event.start_date || event.start_date.slice(0, 10) < day) {
      summary.skipped += 1;
      continue;
    }
    const amount = enrollmentAmountDue(row, event);
    const phone = normalizePhone(participant.phone, participant.region);
    if (amount <= 0 || !phone.ok) {
      summary.skipped += 1;
      continue;
    }

    const locale = participantEmailLocale(participant);
    const language = locale === "zh" ? "zh_CN" : "en_US";
    if (!template.languages.includes(language)) {
      summary.skipped += 1;
      continue;
    }

    // Claim first, and only if they still haven't paid.
    const { data: claimed, error: claimErr } = await service
      .from("enrollments")
      .update({ payment_followup_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "approved")
      .is("payment_followup_sent_at", null)
      .select("id");
    if (claimErr) throw new Error(`followups: claim failed: ${claimErr.message}`);
    if (!claimed?.length) {
      summary.skipped += 1;
      continue;
    }

    const name = (participant.name_en ?? participant.name_cn ?? "").trim() || "Dear participant";
    const title =
      (locale === "zh" ? event.title_cn : event.title_en) || event.title_en || event.title_cn || event.slug;
    const paymentUrl = buildPaymentUrl(createPaymentAccessToken(row.id, PAYMENT_LINK_TTL_MS));

    let result: SendOutboundResult | null = null;
    let sendError: string | null = null;
    try {
      const conversationId = await findOrCreateConversationForBroadcast(service, {
        participantId: participant.id,
        channel: "whatsapp",
        externalThreadId: phone.e164,
      });
      result = (await sendOutboundMessage({
        kind: "template",
        conversationId,
        senderAdminId,
        templateName: TEMPLATE,
        languageCode: language,
        params: {
          variable_1: name,
          variable_2: title,
          variable_3: fmtAmount(amount, event.currency, locale),
          variable_4: paymentUrl,
        },
      })) as SendOutboundResult;
      sendError = result.error;
    } catch (err) {
      sendError = err instanceof Error ? err.message : "send_threw";
    }

    const status = result?.delivery_status ?? "failed";
    if (status === "failed") summary.failed += 1;
    else summary.sent += 1;

    const { error: logErr } = await service.from("notifications").insert({
      participant_id: participant.id,
      enrollment_id: row.id,
      event_id: event.id,
      channel: "whatsapp",
      template: NOTIFICATION_TEMPLATE,
      to_address: phone.e164,
      status,
      provider_id: result?.external_message_id ?? null,
      error_message: sendError,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
    if (logErr) console.warn("[followups] log failed: %s", logErr.message);

    await writeAuditLog({
      actor_id: null,
      action: "whatsapp.followup_sent",
      entity: "enrollments",
      entity_id: row.id,
      metadata: { status, event_id: event.id, language },
    });
  }
  return summary;
}
