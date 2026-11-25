// Client-safe shapes for 名额 · reward seats (migration 082).

export type SeatStatus = "available" | "assigned" | "used" | "cancelled";

export type PersonRef = { id: string; region_id: string | null; name: string };

export type Seat = {
  id: string;
  status: SeatStatus;
  note: string | null;
  course: { id: string; name_cn: string; name_en: string | null };
  holder: PersonRef;
  recipient: PersonRef | null;
  /** The event it was used on. */
  used_on: { enrollment_id: string; event_id: string; title: string; start_date: string | null } | null;
  issued_at: string;
  cancel_reason: string | null;
};

export const SEAT_STATUS_LABEL: Record<SeatStatus, { en: string; cn: string }> = {
  available: { en: "Available", cn: "未分配" },
  assigned: { en: "Given", cn: "已赠送" },
  used: { en: "Used", cn: "已使用" },
  cancelled: { en: "Cancelled", cn: "已作废" },
};

/** Tier key stored on an enrollment priced by a seat. */
export const SEAT_TIER_KEY = "seat";
