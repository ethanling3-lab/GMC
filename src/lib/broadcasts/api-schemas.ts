import { z } from "zod";

// Shared zod schemas for the broadcast API routes — kept in one place so
// the composer client + route handlers + smoke script agree on shape.

const EnrollmentStatusZ = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "paid",
  "cancelled",
]);

const LanguageFluencyZ = z.enum(["en", "cn", "both"]);

const ChannelZ = z.enum(["whatsapp", "email"]);

const ParticipantStatusZ = z.enum([
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
  "lead",
]);

const MotivationZ = z.enum([
  "clean",
  "insurance",
  "direct_sales",
  "spiritual",
  "other",
]);

const ProgrammeTierZ = z.enum([
  "abundance",
  "glorious_family",
  "elite_cultural_heritage",
  "glorious_cultural_heritage",
]);

const EventCohortFilterZ = z.object({
  mode: z.literal("event_cohort"),
  event_id: z.string().uuid(),
  enrollment_statuses: z.array(EnrollmentStatusZ),
  language: LanguageFluencyZ.nullable(),
  tag_slug: z.string().max(40).nullable(),
});

const ParticipantMasterFilterZ = z.object({
  mode: z.literal("participant_master"),
  region: z.string().max(8).nullable(),
  status: z.array(ParticipantStatusZ).nullable(),
  motivation: MotivationZ.nullable(),
  programme_tier: ProgrammeTierZ.nullable(),
  is_old_student: z.boolean().nullable(),
  require_any_of_channels: z.array(ChannelZ).nullable(),
});

export const AudienceFilterZ = z.discriminatedUnion("mode", [
  EventCohortFilterZ,
  ParticipantMasterFilterZ,
]);

export const ChannelsZ = z.array(ChannelZ).min(1).max(2);

export const CreateBroadcastBodyZ = z.object({
  name: z.string().min(1).max(120),
  audience_mode: z.enum(["event_cohort", "participant_master"]),
  audience_filter: AudienceFilterZ,
  channels: ChannelsZ,
  whatsapp_template_name: z.string().max(200).nullable().optional(),
  whatsapp_template_language: z.enum(["en_US", "zh_CN"]).nullable().optional(),
  whatsapp_template_params: z.record(z.string(), z.string()).nullable().optional(),
  email_subject_en: z.string().max(200).nullable().optional(),
  email_subject_cn: z.string().max(200).nullable().optional(),
  email_body_en: z.string().max(20000).nullable().optional(),
  email_body_cn: z.string().max(20000).nullable().optional(),
});

export const PatchBroadcastBodyZ = CreateBroadcastBodyZ.partial();

export const ScheduleBroadcastBodyZ = z.object({
  scheduled_for: z.string().datetime({ offset: true }),
});

export const AudiencePreviewBodyZ = z.object({
  audience_mode: z.enum(["event_cohort", "participant_master"]),
  audience_filter: AudienceFilterZ,
  channels: ChannelsZ,
});

export const PreviewBodyZ = z.object({
  participant_id: z.string().uuid(),
});
