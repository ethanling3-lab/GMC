// Netlify background function — 15-minute timeout, returns 202 immediately.
// Triggered by POST /api/admin/broadcasts/[id]/send (and the cron route for
// scheduled broadcasts). Picks up all `broadcast_recipients` rows with
// status='pending' for the given broadcast_id, sends them respecting
// per-channel concurrency caps, and updates the broadcasts row's stats +
// status as it goes.
//
// Idempotency: status='pending' is the unit of work. Re-invocation
// picks up any pending rows left from a previous (possibly-crashed)
// run. Already-sent / failed / skipped rows are skipped.
//
// Permissions: this function is invoked internally with the
// SUPABASE_SERVICE_ROLE_KEY; it doesn't authenticate the caller. The
// API route that kicks it enforces role gating.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendBroadcastRecipient } from "../../src/lib/broadcasts/send";
import type { InterpolationContext } from "../../src/lib/broadcasts/interpolate";
import type { AudienceFilter } from "../../src/lib/broadcasts/types";

type NetlifyEvent = {
  body?: string | null;
  isBase64Encoded?: boolean;
};

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const WHATSAPP_CONCURRENCY = Math.max(
  1,
  Number(process.env.BROADCAST_WHATSAPP_CONCURRENCY ?? 6),
);
const EMAIL_CONCURRENCY = Math.max(
  1,
  Number(process.env.BROADCAST_EMAIL_CONCURRENCY ?? 10),
);
const BATCH_SIZE = 50;

export async function handler(event: NetlifyEvent): Promise<{ statusCode: number }> {
  let broadcastId: string | undefined;

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const parsed = JSON.parse(raw || "{}") as { broadcast_id?: string };
    broadcastId = parsed.broadcast_id;
    if (!broadcastId) return { statusCode: 400 };

    const supabase = service();

    // Load broadcast row + event (if event-cohort). Constant across
    // recipients, so load once per invocation.
    const broadcast = await loadBroadcast(supabase, broadcastId);
    if (!broadcast) return { statusCode: 404 };

    // Skip if the broadcast was cancelled or already fully processed.
    if (
      broadcast.status === "cancelled" ||
      broadcast.status === "sent" ||
      broadcast.status === "failed"
    ) {
      return { statusCode: 202 };
    }

    if (broadcast.status === "draft" || broadcast.status === "scheduled") {
      await supabase
        .from("broadcasts")
        .update({
          status: "sending",
          started_at: broadcast.started_at ?? new Date().toISOString(),
        })
        .eq("id", broadcastId)
        .eq("status", broadcast.status); // optimistic guard
    }

    const eventRow = await loadEventIfCohort(supabase, broadcast);

    let processedAny = false;
    // Outer loop pulls batches until no more pending rows.
    while (true) {
      const { data: pending, error: queueErr } = await supabase
        .from("broadcast_recipients")
        .select(
          "id, participant_id, enrollment_id, channel, target_address, status",
        )
        .eq("broadcast_id", broadcastId)
        .eq("status", "pending")
        .limit(BATCH_SIZE);
      if (queueErr) throw new Error(`fanout: queue read failed: ${queueErr.message}`);
      const rows = (pending ?? []) as Array<{
        id: string;
        participant_id: string;
        enrollment_id: string | null;
        channel: "whatsapp" | "email";
        target_address: string | null;
        status: "pending";
      }>;
      if (rows.length === 0) break;
      processedAny = true;

      // Load participant context for this batch (and enrollment if needed
      // for ${amount_due} / ${payment_link}). Constant per batch, faster
      // than per-row.
      const participantIds = [...new Set(rows.map((r) => r.participant_id))];
      const enrollmentIds = [
        ...new Set(rows.map((r) => r.enrollment_id).filter((id): id is string => Boolean(id))),
      ];
      const [participantsById, enrollmentsById] = await Promise.all([
        loadParticipantContexts(supabase, participantIds),
        loadEnrollmentContexts(supabase, enrollmentIds),
      ]);

      // Split by channel + cap concurrency per channel.
      const whatsappRows = rows.filter((r) => r.channel === "whatsapp");
      const emailRows = rows.filter((r) => r.channel === "email");

      await Promise.all([
        runChannelBatch(supabase, broadcast, whatsappRows, eventRow, participantsById, enrollmentsById, WHATSAPP_CONCURRENCY),
        runChannelBatch(supabase, broadcast, emailRows, eventRow, participantsById, enrollmentsById, EMAIL_CONCURRENCY),
      ]);
    }

    // Re-check the broadcast didn't get cancelled mid-loop.
    const refreshed = await loadBroadcast(supabase, broadcastId);
    if (!refreshed) return { statusCode: 202 };
    if (refreshed.status === "cancelled") return { statusCode: 202 };

    if (processedAny) {
      const stats = await loadRecipientStats(supabase, broadcastId);
      const finalStatus = computeFinalStatus(stats);
      await supabase
        .from("broadcasts")
        .update({
          status: finalStatus,
          completed_at: new Date().toISOString(),
          stats: {
            queued: stats.total - stats.pending,
            sent: stats.sent,
            failed: stats.failed,
            skipped: stats.skipped,
          },
        })
        .eq("id", broadcastId)
        .neq("status", "cancelled"); // don't overwrite a cancel race
    }

    return { statusCode: 202 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[broadcast-fanout-background] error: ${msg}`);
    if (broadcastId) {
      try {
        await service()
          .from("broadcasts")
          .update({
            // Don't override final status, but surface failure if we crashed
            // before any rows shipped. Conservatively bumps to 'failed' only
            // if still in 'sending'.
            status: "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", broadcastId)
          .eq("status", "sending");
      } catch {
        // best effort
      }
    }
    return { statusCode: 202 };
  }
}

// ---------------------------------------------------------------------------
// Channel batch runner — bounded concurrency over the rows in a channel.
// ---------------------------------------------------------------------------

async function runChannelBatch(
  supabase: SupabaseClient,
  broadcast: BroadcastLoaded,
  rows: Array<RecipientRow>,
  eventRow: EventLoaded | null,
  participants: Map<string, ParticipantContextRow>,
  enrollments: Map<string, EnrollmentContextRow>,
  concurrency: number,
): Promise<void> {
  if (rows.length === 0) return;
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const i = cursor++;
      const r = rows[i];
      await processRow(supabase, broadcast, r, eventRow, participants, enrollments);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()),
  );
}

async function processRow(
  supabase: SupabaseClient,
  broadcast: BroadcastLoaded,
  row: RecipientRow,
  eventRow: EventLoaded | null,
  participants: Map<string, ParticipantContextRow>,
  enrollments: Map<string, EnrollmentContextRow>,
): Promise<void> {
  const participant = participants.get(row.participant_id);
  if (!participant) {
    await supabase
      .from("broadcast_recipients")
      .update({
        status: "failed",
        error_code: "provider",
        error_message: "participant not found at send time",
        attempted_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return;
  }

  const enrollment = row.enrollment_id ? enrollments.get(row.enrollment_id) ?? null : null;

  const ctx: InterpolationContext = {
    participant: {
      name_cn: participant.name_cn,
      name_en: participant.name_en,
      region_id: participant.region_id,
      language_fluency: participant.language_fluency,
    },
    event: eventRow
      ? {
          title_en: eventRow.title_en,
          title_cn: eventRow.title_cn,
          start_date: eventRow.start_date,
          end_date: eventRow.end_date,
          venue: eventRow.venue,
          main_venue_hotel_name: eventRow.main_venue_hotel_name,
          price: eventRow.price,
        }
      : null,
    enrollment: enrollment
      ? { id: enrollment.id, amount_due: enrollment.amount_due ?? null }
      : null,
  };

  await supabase
    .from("broadcast_recipients")
    .update({ attempted_at: new Date().toISOString() })
    .eq("id", row.id);

  const outcome = await sendBroadcastRecipient(
    supabase,
    {
      id: broadcast.id,
      created_by: broadcast.created_by,
      whatsapp_template_name: broadcast.whatsapp_template_name,
      whatsapp_template_language: broadcast.whatsapp_template_language,
      whatsapp_template_params: broadcast.whatsapp_template_params,
      email_subject_en: broadcast.email_subject_en,
      email_subject_cn: broadcast.email_subject_cn,
      email_body_en: broadcast.email_body_en,
      email_body_cn: broadcast.email_body_cn,
    },
    {
      id: row.id,
      participant_id: row.participant_id,
      channel: row.channel,
      target_address: row.target_address,
    },
    ctx,
  );

  await supabase
    .from("broadcast_recipients")
    .update({
      status: outcome.status,
      error_code: outcome.error_code,
      error_message: outcome.error_message,
      external_message_id: outcome.external_message_id,
      conversation_id: outcome.conversation_id,
      message_id: outcome.message_id,
      sent_at: outcome.status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", row.id);
}

// ---------------------------------------------------------------------------
// Context loaders
// ---------------------------------------------------------------------------

type BroadcastLoaded = {
  id: string;
  status: string;
  audience_mode: "event_cohort" | "participant_master";
  audience_filter: AudienceFilter;
  channels: ("whatsapp" | "email")[];
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
  whatsapp_template_params: Record<string, string> | null;
  email_subject_en: string | null;
  email_subject_cn: string | null;
  email_body_en: string | null;
  email_body_cn: string | null;
  created_by: string;
  started_at: string | null;
};

type EventLoaded = {
  id: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  main_venue_hotel_name: string | null;
  price: number | string | null;
};

type ParticipantContextRow = {
  id: string;
  name_cn: string | null;
  name_en: string | null;
  region_id: string | null;
  language_fluency: "en" | "cn" | "both" | null;
};

type EnrollmentContextRow = {
  id: string;
  amount_due?: number | string | null;
};

type RecipientRow = {
  id: string;
  participant_id: string;
  enrollment_id: string | null;
  channel: "whatsapp" | "email";
  target_address: string | null;
};

async function loadBroadcast(
  supabase: SupabaseClient,
  id: string,
): Promise<BroadcastLoaded | null> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select(
      "id, status, audience_mode, audience_filter, channels, whatsapp_template_name, whatsapp_template_language, whatsapp_template_params, email_subject_en, email_subject_cn, email_body_en, email_body_cn, created_by, started_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as BroadcastLoaded;
}

async function loadEventIfCohort(
  supabase: SupabaseClient,
  broadcast: BroadcastLoaded,
): Promise<EventLoaded | null> {
  if (broadcast.audience_mode !== "event_cohort") return null;
  const filter = broadcast.audience_filter;
  if (filter.mode !== "event_cohort") return null;
  const { data, error } = await supabase
    .from("events")
    .select("id, title_en, title_cn, start_date, end_date, venue, main_venue_hotel_name, price")
    .eq("id", filter.event_id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as EventLoaded;
}

async function loadParticipantContexts(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ParticipantContextRow>> {
  const out = new Map<string, ParticipantContextRow>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("participants")
    .select("id, name_cn, name_en, region_id, language_fluency")
    .in("id", ids);
  if (error) throw new Error(`participant context load failed: ${error.message}`);
  for (const r of (data ?? []) as ParticipantContextRow[]) {
    out.set(r.id, r);
  }
  return out;
}

async function loadEnrollmentContexts(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, EnrollmentContextRow>> {
  const out = new Map<string, EnrollmentContextRow>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, amount_due")
    .in("id", ids);
  if (error) throw new Error(`enrollment context load failed: ${error.message}`);
  for (const r of (data ?? []) as EnrollmentContextRow[]) {
    out.set(r.id, r);
  }
  return out;
}

async function loadRecipientStats(
  supabase: SupabaseClient,
  broadcastId: string,
): Promise<{ total: number; pending: number; sent: number; failed: number; skipped: number }> {
  const base = () =>
    supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);
  const [total, pending, sent, failed, skipped] = await Promise.all([
    base(),
    base().eq("status", "pending"),
    base().eq("status", "sent"),
    base().eq("status", "failed"),
    base().eq("status", "skipped"),
  ]);
  return {
    total: total.count ?? 0,
    pending: pending.count ?? 0,
    sent: sent.count ?? 0,
    failed: failed.count ?? 0,
    skipped: skipped.count ?? 0,
  };
}

function computeFinalStatus(stats: {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}): "sent" | "partial" | "failed" {
  if (stats.failed === 0) return "sent";
  if (stats.sent === 0 && stats.skipped === 0) return "failed";
  return "partial";
}
