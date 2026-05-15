// Shared types for the M7.1 on-site check-in flow. Server + client safe.

export type CheckInMethod = "qr" | "manual" | "face_match";

export type CheckInRow = {
  id: string;
  event_id: string;
  enrollment_id: string;
  participant_id: string;
  checked_in_at: string;
  checked_in_by: string | null;
  method: CheckInMethod;
  notes: string | null;
};

export type CheckInRosterEntry = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  group_no: number | null;
  seat_no: number | null;
  checked_in_at: string | null;
  check_in_method: CheckInMethod | null;
};

export type CheckInStats = {
  total_eligible: number;
  total_checked_in: number;
  by_method: { qr: number; manual: number; face_match: number };
};

export type CheckInRecent = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  group_no: number | null;
  checked_in_at: string;
  method: CheckInMethod;
};

// --- M7.1b richer dashboard --------------------------------------------------

export type CheckInVelocity = {
  // Counts in the most recent rolling windows.
  last_15min: number;
  last_60min: number;
  // Projected finish ISO timestamp if rate_per_min > 0 and there are
  // remaining eligible attendees. null when the door is full or no one
  // has scanned recently.
  eta_iso: string | null;
};

export type CheckInGroupRow = {
  group_id: string;
  group_no: number | null;          // null = "Ungrouped" synthetic bucket
  group_class: string | null;
  name_en: string | null;
  name_cn: string | null;
  expected_count: number;
  checked_in_count: number;
};

export type CheckInAbsentRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
};

export type CheckInTimeBucket = {
  // Start of the 5-minute (configurable) bucket in ISO. Continuous — zero-
  // count buckets are emitted so the sparkline has a smooth X axis.
  bucket_start: string;
  count: number;
};
