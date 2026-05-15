import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import {
  EMBEDDING_LEN,
  type FaceBankEntry,
  type FaceEmbedding,
} from "./types";

// Server-only loader for the per-event embedding bank consumed by the
// scanner station. Filters to participants who:
//   - Have an approved or paid enrolment for this event
//   - Explicitly opted in to facial_recognition_consent
//   - Already have a computed face_embedding (non-null)
//
// Returns a thin slice — region_id, name, photo, group/seat — so the
// confirmation card has everything it needs without a second round-trip.

export type FaceBankSummary = {
  total_eligible: number;        // approved+paid participants for the event
  with_consent: number;          // …that opted in
  with_embedding: number;        // …that have an embedding ready
};

export type LoadFaceBankResult = {
  bank: FaceBankEntry[];
  summary: FaceBankSummary;
};

export async function loadFaceBank(
  eventId: string,
): Promise<LoadFaceBankResult> {
  const supabase = createSupabaseServiceClient();

  // Pull eligible enrolments + their participant row in one trip. Status
  // gate mirrors the dashboard's eligibility (approved | paid).
  const { data: rows, error } = await supabase
    .from("enrollments")
    .select(
      "id, participant_id, status, payment_status, " +
        "participants!inner(id, region_id, name_cn, name_en, front_photo_url, " +
        "facial_recognition_consent, face_embedding)",
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"]);
  if (error) throw new Error(`[face-bank] enrolment query: ${error.message}`);

  type Row = {
    id: string;
    participant_id: string;
    participants: {
      id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      front_photo_url: string | null;
      facial_recognition_consent: boolean;
      face_embedding: FaceEmbedding | null;
    };
  };

  let total_eligible = 0;
  let with_consent = 0;
  let with_embedding = 0;
  const participantIds: string[] = [];
  const enrolmentByParticipant = new Map<string, string>();
  const stagedEntries: Omit<FaceBankEntry, "group_no" | "seat_no">[] = [];

  for (const raw of (rows ?? []) as unknown as Row[]) {
    const p = raw.participants;
    if (!p) continue;
    total_eligible += 1;
    if (!p.facial_recognition_consent) continue;
    with_consent += 1;
    if (!p.face_embedding || p.face_embedding.length !== EMBEDDING_LEN) continue;
    with_embedding += 1;
    participantIds.push(p.id);
    enrolmentByParticipant.set(p.id, raw.id);
    stagedEntries.push({
      participant_id: p.id,
      enrollment_id: raw.id,
      region_id: p.region_id,
      name_cn: p.name_cn,
      name_en: p.name_en,
      photo_url: p.front_photo_url,
      embedding: p.face_embedding,
    });
  }

  // Attach group_no + seat_no from event_seat_assignments so the
  // confirmation card can guide staff to the right table on success.
  const groupByParticipant = new Map<string, { group_no: number | null; seat_no: number | null }>();
  if (participantIds.length > 0) {
    const { data: seats, error: seatErr } = await supabase
      .from("event_seat_assignments")
      .select("participant_id, seat_no, event_groups!inner(group_no)")
      .eq("event_id", eventId)
      .in("participant_id", participantIds);
    if (seatErr) throw new Error(`[face-bank] seat query: ${seatErr.message}`);
    for (const s of (seats ?? []) as unknown as Array<{
      participant_id: string;
      seat_no: number | null;
      event_groups: { group_no: number | null } | null;
    }>) {
      groupByParticipant.set(s.participant_id, {
        group_no: s.event_groups?.group_no ?? null,
        seat_no: s.seat_no ?? null,
      });
    }
  }

  const bank: FaceBankEntry[] = stagedEntries.map((e) => ({
    ...e,
    group_no: groupByParticipant.get(e.participant_id)?.group_no ?? null,
    seat_no: groupByParticipant.get(e.participant_id)?.seat_no ?? null,
  }));

  return {
    bank,
    summary: { total_eligible, with_consent, with_embedding },
  };
}
