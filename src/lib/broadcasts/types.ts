// Client-safe types for the broadcast/blast module. Server-only logic
// (audience resolution, send engine, queries) lives in sibling files
// that import "server-only" — this file stays dependency-free so the
// composer + list/detail UI can import without dragging server symbols
// through Turbopack's bundler boundary.

import type {
  MotivationTag,
} from "@/lib/participants-query";

export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "partial"
  | "cancelled"
  | "failed";

export const BROADCAST_STATUS_VALUES: readonly BroadcastStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "partial",
  "cancelled",
  "failed",
] as const;

export type BroadcastChannel = "whatsapp" | "email";

export const BROADCAST_CHANNEL_VALUES: readonly BroadcastChannel[] = [
  "whatsapp",
  "email",
] as const;

export type BroadcastAudienceMode = "event_cohort" | "participant_master";

export type BroadcastRecipientStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped";

export const BROADCAST_RECIPIENT_STATUS_VALUES: readonly BroadcastRecipientStatus[] = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;

// Stable machine tag for recipient failures.
//
// Retry eligibility is an ALLOWLIST in requeueFailedRecipients — a code that
// isn't listed there is never re-sent. 'opted_out' and 'frequency_capped' are
// deliberately absent: Meta treats both as signals to stop, and re-sending
// damages the quality rating that gates every messaging-tier increase. They
// used to be indistinguishable from 'provider', so one click on Retry failed
// re-sent to every person who had opted out.
export type BroadcastErrorCode =
  | "no_address"
  | "outside_window"
  | "opted_out"
  | "frequency_capped"
  | "provider"
  | "cancelled"
  | "unknown";

// ---------------------------------------------------------------------------
// Audience filter shapes (serialized into broadcasts.audience_filter jsonb)
// ---------------------------------------------------------------------------

export type EventCohortFilter = {
  mode: "event_cohort";
  event_id: string;
  // Empty array = "all statuses". Composer defaults to ['approved', 'paid'].
  enrollment_statuses: EnrollmentStatusForBroadcast[];
  language: BroadcastLanguageFluency | null;
  tag_slug: string | null;
};

// Mirror of public.enrollment_status enum (001_initial_schema.sql:35).
export type EnrollmentStatusForBroadcast =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid"
  | "cancelled";

// Mirror of public.language_fluency (030_grouping_signals.sql:23).
export type BroadcastLanguageFluency = "en" | "cn" | "both";

export type ParticipantMasterFilter = {
  mode: "participant_master";
  region: string | null; // ISO country code; optional, no longer role-forced
  // Archived people are excluded unless you explicitly ask for them. This is
  // the ONLY reachability exclusion left on this filter — the participant
  // lifecycle enum that used to sit here was dropped in migration 053 after
  // its default silently hid every WhatsApp-only contact from every broadcast.
  include_archived: boolean;
  motivation: MotivationTag | null;
  programme_tier: BroadcastProgrammeTier | null;
  is_old_student: boolean | null;
};

// A programme SLUG from the admin-managed programmes table (dynamic). The 4
// original tiers keep their slugs, so this stays string-typed.
export type BroadcastProgrammeTier = string;

export type AudienceFilter = EventCohortFilter | ParticipantMasterFilter;

// ---------------------------------------------------------------------------
// Wire shapes (API response rows + composer state)
// ---------------------------------------------------------------------------

export type BroadcastListRow = {
  id: string;
  name: string;
  audience_mode: BroadcastAudienceMode;
  audience_summary: string; // e.g. "Event: The Golden Principles · approved, paid"
  audience_snapshot_count: number;
  channels: BroadcastChannel[];
  status: BroadcastStatus;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  stats: BroadcastStats;
  created_by: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
  } | null;
  created_at: string;
};

export type BroadcastStats = {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
};

export function emptyBroadcastStats(): BroadcastStats {
  return { queued: 0, sent: 0, failed: 0, skipped: 0 };
}

export type BroadcastRecipientRow = {
  id: string;
  broadcast_id: string;
  participant_id: string;
  enrollment_id: string | null;
  channel: BroadcastChannel;
  target_address: string | null;
  status: BroadcastRecipientStatus;
  error_message: string | null;
  error_code: BroadcastErrorCode | null;
  external_message_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  attempted_at: string | null;
  sent_at: string | null;
};

// ---------------------------------------------------------------------------
// Interpolation tokens — the whitelist the composer + sender share.
// Server-side resolver lives in src/lib/broadcasts/interpolate.ts.
// ---------------------------------------------------------------------------

export type InterpolationToken =
  | "${name_cn}"
  | "${name_en}"
  | "${name}"
  | "${region_id}"
  | "${event.title}"
  | "${event.title_en}"
  | "${event.title_cn}"
  | "${event.start_date}"
  | "${event.end_date}"
  | "${event.venue}"
  | "${event.main_venue_hotel_name}"
  | "${amount_due}"
  | "${payment_link}";

export type InterpolationTokenSpec = {
  token: InterpolationToken;
  label_en: string;
  label_cn: string;
  // 'participant' = always available; 'event' = event-cohort mode only;
  // 'enrollment' = event-cohort mode only AND requires enrollment row.
  scope: "participant" | "event" | "enrollment";
};

export const INTERPOLATION_TOKENS: readonly InterpolationTokenSpec[] = [
  { token: "${name}", label_en: "Name (recipient locale)", label_cn: "姓名（按语言）", scope: "participant" },
  { token: "${name_cn}", label_en: "Name · 中文", label_cn: "中文姓名", scope: "participant" },
  { token: "${name_en}", label_en: "Name · EN", label_cn: "英文姓名", scope: "participant" },
  { token: "${region_id}", label_en: "Region ID", label_cn: "学员编号", scope: "participant" },
  { token: "${event.title}", label_en: "Event title (locale)", label_cn: "活动名称（按语言）", scope: "event" },
  { token: "${event.title_en}", label_en: "Event title · EN", label_cn: "活动名称 · EN", scope: "event" },
  { token: "${event.title_cn}", label_en: "Event title · 中文", label_cn: "活动名称 · 中文", scope: "event" },
  { token: "${event.start_date}", label_en: "Event start date", label_cn: "活动开始日期", scope: "event" },
  { token: "${event.end_date}", label_en: "Event end date", label_cn: "活动结束日期", scope: "event" },
  { token: "${event.venue}", label_en: "Event venue", label_cn: "活动地点", scope: "event" },
  { token: "${event.main_venue_hotel_name}", label_en: "Main venue hotel", label_cn: "主会场酒店", scope: "event" },
  { token: "${amount_due}", label_en: "Amount due (price)", label_cn: "应付金额", scope: "enrollment" },
  { token: "${payment_link}", label_en: "Payment link", label_cn: "付款链接", scope: "enrollment" },
] as const;

// Unresolved-token detection moved to src/lib/outbound-tokens.ts so the
// broadcast composer and the inbox send path share one definition — and so it
// is actually *called*. The version that lived here matched only `${...}`,
// claimed in its own comment to be wired into a pre-send check, and had zero
// call sites; a message reading "Hi {name}" reached a real number past it.
export { findUnresolvedTokens } from "@/lib/outbound-tokens";

// ---------------------------------------------------------------------------
// Bilingual status labels (used by pills + audit metadata)
// ---------------------------------------------------------------------------

export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, { en: string; cn: string }> = {
  draft: { en: "Draft", cn: "草稿" },
  scheduled: { en: "Scheduled", cn: "已排程" },
  sending: { en: "Sending", cn: "发送中" },
  sent: { en: "Sent", cn: "已送达" },
  partial: { en: "Partial", cn: "部分发送" },
  cancelled: { en: "Cancelled", cn: "已取消" },
  failed: { en: "Failed", cn: "失败" },
};

export const BROADCAST_RECIPIENT_STATUS_LABEL: Record<
  BroadcastRecipientStatus,
  { en: string; cn: string }
> = {
  pending: { en: "Pending", cn: "待发送" },
  sent: { en: "Sent", cn: "已送达" },
  failed: { en: "Failed", cn: "失败" },
  skipped: { en: "Skipped", cn: "已跳过" },
};

export const BROADCAST_CHANNEL_LABEL: Record<BroadcastChannel, { en: string; cn: string }> = {
  whatsapp: { en: "WhatsApp", cn: "WhatsApp" },
  email: { en: "Email", cn: "邮件" },
};

export const BROADCAST_ERROR_CODE_LABEL: Record<BroadcastErrorCode, { en: string; cn: string }> = {
  no_address: { en: "No address", cn: "无联络方式" },
  outside_window: { en: "Outside 24h window", cn: "超出 24h 时窗" },
  opted_out: { en: "Opted out", cn: "已退订" },
  frequency_capped: { en: "Meta frequency cap", cn: "Meta 频率限制" },
  provider: { en: "Provider error", cn: "供应商错误" },
  cancelled: { en: "Cancelled", cn: "已取消" },
  unknown: { en: "Unknown error", cn: "未知错误" },
};
