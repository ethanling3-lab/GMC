// M6.8 — profile-deck export.
//
// One PPT slide per enrolled participant for Dr Wu's pre-event briefing.
// Shape is shared between the server-side loader and the client-side
// pptxgenjs renderer, so it lives in its own types file with no runtime
// imports.

import type {
  GroupClassKey,
  ProgrammeTier,
  SeatRole,
} from "@/components/admin/layout/types";

export type AttendedCourse = {
  course_name: string;
  programme_tier?: ProgrammeTier | null;
  date?: string | null;
};

export type ProfileDeckRow = {
  enrollment_id: string;
  participant_id: string;
  // Identity
  region: string | null;          // ISO code (MY/SG/TW/HK/CN)
  region_id: string | null;       // MY001 etc.
  name_en: string | null;
  name_cn: string | null;
  dharma_name: string | null;
  // Profile signals
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
  religion: string | null;
  is_old_student: boolean;
  cs_notes: string | null;
  // Briefing card extras — rendered on the deck only.
  referrer_name: string | null;
  personality: string | null;
  upgrade_potential: "low" | "medium" | "high" | null;
  /**
   * Names of the curated 组长 + 副组长 at this person's table. Derived in
   * the loader from event_seat_assignments where role IN ('zu_zhang',
   * 'fu_zu_zhang'). Empty array when ungrouped or no leader yet.
   */
  group_leader_names: string[];
  // Migration 030 — language_fluency (used in deck for "上课语种").
  language_fluency: "en" | "cn" | "both" | null;
  // Migration 032 — sectioned briefing fields (个人 / 上课 / 客服).
  sub_region: string | null;
  training_level: string | null;
  health_status: string | null;
  family_situation: string | null;
  dietary_needs: string | null;
  interaction_notes: string | null;
  course_needs: string | null;
  suggested_group_leader_notes: string | null;
  recommended_courses: string | null;
  forbidden_courses: string | null;
  cs_evaluation: string | null;
  // Programme + history
  programme_tier: ProgrammeTier | null;
  attended_courses: AttendedCourse[];
  // Visual asset
  front_photo_url: string | null;
  // Enrollment context
  enrollment_status: string;
  // Group position (null when no group has been generated)
  group_no: number | null;
  group_name_cn: string | null;
  group_name_en: string | null;
  group_class: GroupClassKey | null;
  role: SeatRole | null;
};

export type ProfileDeckEventMeta = {
  event_id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  city: string | null;
};

export type ProfileDeckPayload = {
  event: ProfileDeckEventMeta;
  rows: ProfileDeckRow[];
};
