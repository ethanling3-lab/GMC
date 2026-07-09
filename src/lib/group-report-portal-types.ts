import type { GroupReportSchema } from "@/lib/group-report-schema";

// Client-safe shapes for the leader-facing group-report fill flow. Loaders
// live in group-report-portal.ts (server-only) and return these.

export type GroupReportMember = {
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  role: string;
};

export type GroupReportSubmissionState = {
  status: "draft" | "submitted";
  group_answers: Record<string, unknown>;
  member_answers: Record<string, Record<string, unknown>>;
  submitted_at: string | null;
};

export type GroupReportFillData = {
  group: { id: string; group_no: number; event_id: string };
  event: { id: string; title_en: string | null; title_cn: string | null };
  schema: GroupReportSchema;
  members: GroupReportMember[];
  submission: GroupReportSubmissionState | null;
};

export type LeaderGroupReportItem = {
  group_id: string;
  group_no: number;
  event_id: string;
  event_title: string | null;
  status: "draft" | "submitted" | null;
};
