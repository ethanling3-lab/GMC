import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import { ensureQrToken } from "../check-in/qr-token";
import {
  hasReminderBeenSent,
  sendEventReminder,
  type ReminderWindow,
} from "./notify-reminder";

// Orchestrator for the M7.2 reminder cron. Run hourly via Netlify
// scheduled function → POST /api/cron/reminders. Idempotent — re-running
// inside the same window won't re-bombard participants because each
// attempted send is logged in `notifications` and we filter on prior
// template-channel attempts.
//
// Window logic for the 48h reminder:
//   hours_until_event must be between MIN_48H and MAX_48H.
//   The first cron tick inside that band sends; subsequent ticks dedupe.
// 24h reminder is wired the same way but disabled at v1 (admin can flip
// REMINDER_24H_ENABLED via env when they want it).

const MIN_48H = 36; // start sending 60h before to catch all hourly ticks
const MAX_48H = 60; // ... up to 36h before
const MIN_24H = 12;
const MAX_24H = 36;

const MAX_PER_RUN = Number(process.env.REMINDER_MAX_PER_RUN ?? 200);
const REMINDER_24H_ENABLED =
  (process.env.REMINDER_24H_ENABLED ?? "false").toLowerCase() === "true";

type EnrolmentRow = {
  id: string;
  event_id: string;
  participant_id: string;
  status: string;
  payment_status: string;
  qr_token: string | null;
  participant: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
    email: string | null;
    phone: string | null;
    language_fluency: string | null;
  } | null;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    venue: string | null;
    city: string | null;
  } | null;
};

export type CronRunSummary = {
  window: ReminderWindow;
  scanned: number;
  sent: number;
  skipped_already_sent: number;
  skipped_no_email: number;
  skipped_no_token: number;
  failed: number;
  events_in_window: string[];
};

export async function runReminderCron(): Promise<{
  ran_at: string;
  windows: CronRunSummary[];
}> {
  const ranAt = new Date().toISOString();
  const windows: CronRunSummary[] = [];

  const w48 = await runForWindow("48h", MIN_48H, MAX_48H);
  windows.push(w48);

  if (REMINDER_24H_ENABLED) {
    const w24 = await runForWindow("24h", MIN_24H, MAX_24H);
    windows.push(w24);
  }

  return { ran_at: ranAt, windows };
}

async function runForWindow(
  window: ReminderWindow,
  minHours: number,
  maxHours: number,
): Promise<CronRunSummary> {
  const supabase = createSupabaseServiceClient();
  const now = Date.now();
  // ISO bounds: start_date >= now + minHours, start_date <= now + maxHours.
  const lowerBound = new Date(now + minHours * 3600 * 1000).toISOString();
  const upperBound = new Date(now + maxHours * 3600 * 1000).toISOString();

  // Pull every event whose start_date sits inside this window. Events are
  // cheap to enumerate — orders of magnitude fewer than enrolments.
  const { data: events, error: eventErr } = await supabase
    .from("events")
    .select("id, slug, start_date")
    .gte("start_date", lowerBound)
    .lte("start_date", upperBound)
    .neq("status", "archived");
  if (eventErr) {
    throw new Error(`[reminders] event lookup failed: ${eventErr.message}`);
  }

  const summary: CronRunSummary = {
    window,
    scanned: 0,
    sent: 0,
    skipped_already_sent: 0,
    skipped_no_email: 0,
    skipped_no_token: 0,
    failed: 0,
    events_in_window: (events ?? []).map((e) => e.slug),
  };

  if (!events || events.length === 0) return summary;
  const eventIds = events.map((e) => e.id);

  // Paid enrolments only. Status check is belt-and-braces: payment_status
  // is the canonical flag but we also accept status='paid' to handle older
  // rows where the two diverged.
  const { data: enrolments, error: enrolErr } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, participant_id, status, payment_status, qr_token, " +
        "participant:participants!inner(id, name_en, name_cn, email, phone, language_fluency), " +
        "event:events!inner(id, slug, title_en, title_cn, start_date, venue, city)",
    )
    .in("event_id", eventIds)
    .or("status.eq.paid,payment_status.eq.paid")
    .limit(MAX_PER_RUN);
  if (enrolErr) {
    throw new Error(`[reminders] enrolment lookup failed: ${enrolErr.message}`);
  }

  for (const raw of enrolments ?? []) {
    const row = raw as unknown as EnrolmentRow;
    summary.scanned += 1;

    if (!row.participant || !row.event) continue;
    if (!row.participant.email) {
      summary.skipped_no_email += 1;
      continue;
    }

    // Ensure the participant has a qr_token. Lazy mint covers any paid row
    // whose token was never persisted (legacy + paid-via-webhook race).
    let qrToken = row.qr_token;
    if (!qrToken) {
      qrToken = await ensureQrToken(supabase, row.id);
      if (!qrToken) {
        summary.skipped_no_token += 1;
        continue;
      }
    }

    const already = await hasReminderBeenSent(row.id, window, "email");
    if (already) {
      summary.skipped_already_sent += 1;
      continue;
    }

    const result = await sendEventReminder({
      enrollment: {
        id: row.id,
        event_id: row.event_id,
        participant_id: row.participant_id,
        qr_token: qrToken,
      },
      participant: row.participant,
      event: row.event,
      window,
    });
    if (result.ok) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
      console.warn(
        `[reminders] send failed for enrolment ${row.id}: ${result.reason}`,
      );
    }
  }

  return summary;
}
