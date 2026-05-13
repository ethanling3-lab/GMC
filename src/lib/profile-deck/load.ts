import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase";
import type {
  AttendedCourse,
  ProfileDeckEventMeta,
  ProfileDeckPayload,
  ProfileDeckRow,
} from "./types";
import type { SeatRole } from "@/components/admin/layout/types";

// Ordering note: the profile deck mirrors Dr Wu's per-event briefing flow,
// which works table-by-table. So we order by:
//   1. group_no asc            (ungrouped participants land at the end)
//   2. role priority            (zu_zhang first → fu_zu_zhang → participant → pai_zhang)
//   3. region_id asc            (stable within a role)
//
// "Ungrouped" = enrolled in the event but no event_seat_assignments row yet.
// These show up after every group_no'd row so the briefing can punt them.

const ROLE_PRIORITY: Record<SeatRole, number> = {
  zu_zhang: 0,
  fu_zu_zhang: 1,
  participant: 2,
  pai_zhang: 3,
};

export async function loadProfileDeck(
  eventId: string,
): Promise<ProfileDeckPayload> {
  const supabase = createSupabaseServiceClient();

  // ---- Event meta --------------------------------------------------------
  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select(
      "id, slug, title_en, title_cn, start_date, end_date, venue, city",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (evErr || !ev) {
    throw new Error(evErr?.message ?? "event_not_found");
  }
  const event: ProfileDeckEventMeta = {
    event_id: ev.id,
    slug: ev.slug,
    title_en: ev.title_en ?? null,
    title_cn: ev.title_cn ?? null,
    start_date: ev.start_date ?? null,
    end_date: ev.end_date ?? null,
    venue: ev.venue ?? null,
    city: ev.city ?? null,
  };

  // ---- Enrollments (only states that justify a briefing slide) ----------
  const { data: enrols, error: enrErr } = await supabase
    .from("enrollments")
    .select("id, participant_id, status")
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"]);
  if (enrErr) throw new Error(enrErr.message);
  const enrollments = enrols ?? [];
  if (enrollments.length === 0) {
    return { event, rows: [] };
  }

  const participantIds = enrollments.map((e) => e.participant_id);

  // ---- Participants ------------------------------------------------------
  const { data: parts, error: pErr } = await supabase
    .from("participants")
    .select(
      "id, region, region_id, name_en, name_cn, dharma_name, gender, birth_date, occupation, industry, religion, is_old_student, cs_notes, programme_tier, attended_courses, front_photo_url, sub_region, training_level, health_status, family_situation, dietary_needs, interaction_notes, course_needs, suggested_group_leader_notes, recommended_courses, forbidden_courses, cs_evaluation, language_fluency, referrer_name, personality, upgrade_potential",
    )
    .in("id", participantIds);
  if (pErr) throw new Error(pErr.message);
  const participantById = new Map(
    (parts ?? []).map((p) => [p.id as string, p]),
  );

  // ---- Seat assignments (group_no via event_groups join) ----------------
  const { data: seats, error: sErr } = await supabase
    .from("event_seat_assignments")
    .select(
      "participant_id, role, group_id, event_groups!inner(group_no, name_en, name_cn, group_class)",
    )
    .eq("event_id", eventId)
    .in("participant_id", participantIds);
  if (sErr) throw new Error(sErr.message);
  type SeatRow = {
    participant_id: string;
    role: SeatRole;
    group_id: string | null;
    event_groups: {
      group_no: number;
      name_en: string | null;
      name_cn: string | null;
      group_class: ProfileDeckRow["group_class"];
    } | null;
  };
  const seatByPid = new Map<string, SeatRow>();
  for (const s of (seats ?? []) as unknown as SeatRow[]) {
    seatByPid.set(s.participant_id, s);
  }

  // ---- Group leader roster (per group_id) --------------------------------
  // For the "组长" row on each card we want the 组长 + 副组长 names AT this
  // person's table. Re-query event_seat_assignments scoped to the groups
  // represented in the result, restricted to leader roles, then look up
  // their CN names via the participantById map (already loaded).
  //
  // Leaders may sit at a table whose other members aren't in this event
  // (edge case — shouldn't happen in practice), so we widen the participant
  // map with a small follow-up SELECT for any unseen leader IDs.
  const groupIds = Array.from(
    new Set(
      (seats ?? [])
        .map((s) => (s as unknown as SeatRow).group_id)
        .filter((g): g is string => Boolean(g)),
    ),
  );
  const groupLeadersByGroupId = new Map<string, string[]>();
  if (groupIds.length > 0) {
    const { data: leaderRows, error: lErr } = await supabase
      .from("event_seat_assignments")
      .select("participant_id, role, group_id")
      .eq("event_id", eventId)
      .in("group_id", groupIds)
      .in("role", ["zu_zhang", "fu_zu_zhang"]);
    if (lErr) throw new Error(lErr.message);

    // Widen participantById to cover any leader who isn't already loaded
    // (e.g. a 组长 whose own enrollment is for a different event scope).
    const unknownLeaderIds = (leaderRows ?? [])
      .map((r) => r.participant_id as string)
      .filter((id) => !participantById.has(id));
    if (unknownLeaderIds.length > 0) {
      const { data: extraParts } = await supabase
        .from("participants")
        .select("id, name_cn, name_en")
        .in("id", unknownLeaderIds);
      for (const p of extraParts ?? []) {
        if (!participantById.has(p.id as string)) {
          participantById.set(p.id as string, p as unknown as typeof parts[number]);
        }
      }
    }

    // role priority: zu_zhang first, then fu_zu_zhang. Stable order by name.
    type LeaderRow = {
      participant_id: string;
      role: "zu_zhang" | "fu_zu_zhang";
      group_id: string;
    };
    const sorted = ([...((leaderRows ?? []) as unknown as LeaderRow[])]).sort(
      (a, b) => {
        if (a.role !== b.role) return a.role === "zu_zhang" ? -1 : 1;
        return 0;
      },
    );
    for (const lr of sorted) {
      const p = participantById.get(lr.participant_id);
      const nm = (p?.name_cn ?? p?.name_en ?? "").trim();
      if (!nm) continue;
      const arr = groupLeadersByGroupId.get(lr.group_id) ?? [];
      if (!arr.includes(nm)) arr.push(nm);
      groupLeadersByGroupId.set(lr.group_id, arr);
    }
  }

  // ---- Build rows --------------------------------------------------------
  const rows: ProfileDeckRow[] = enrollments.map((e) => {
    const p = participantById.get(e.participant_id);
    const seat = seatByPid.get(e.participant_id);
    return {
      enrollment_id: e.id,
      participant_id: e.participant_id,
      region: p?.region ?? null,
      region_id: p?.region_id ?? null,
      name_en: p?.name_en ?? null,
      name_cn: p?.name_cn ?? null,
      dharma_name: p?.dharma_name ?? null,
      gender: p?.gender ?? null,
      birth_date: p?.birth_date ?? null,
      occupation: p?.occupation ?? null,
      industry: p?.industry ?? null,
      religion: p?.religion ?? null,
      is_old_student: p?.is_old_student ?? false,
      cs_notes: p?.cs_notes ?? null,
      sub_region: p?.sub_region ?? null,
      training_level: p?.training_level ?? null,
      health_status: p?.health_status ?? null,
      family_situation: p?.family_situation ?? null,
      dietary_needs: p?.dietary_needs ?? null,
      interaction_notes: p?.interaction_notes ?? null,
      course_needs: p?.course_needs ?? null,
      suggested_group_leader_notes: p?.suggested_group_leader_notes ?? null,
      recommended_courses: p?.recommended_courses ?? null,
      forbidden_courses: p?.forbidden_courses ?? null,
      cs_evaluation: p?.cs_evaluation ?? null,
      language_fluency:
        (p?.language_fluency as "en" | "cn" | "both" | null | undefined) ?? null,
      programme_tier: p?.programme_tier ?? null,
      attended_courses: Array.isArray(p?.attended_courses)
        ? (p!.attended_courses as AttendedCourse[])
        : [],
      front_photo_url: p?.front_photo_url ?? null,
      enrollment_status: e.status,
      group_no: seat?.event_groups?.group_no ?? null,
      group_name_en: seat?.event_groups?.name_en ?? null,
      group_name_cn: seat?.event_groups?.name_cn ?? null,
      group_class: seat?.event_groups?.group_class ?? null,
      role: seat?.role ?? null,
      referrer_name: (p as { referrer_name?: string | null } | undefined)
        ?.referrer_name ?? null,
      personality: (p as { personality?: string | null } | undefined)
        ?.personality ?? null,
      upgrade_potential: (
        (p as { upgrade_potential?: "low" | "medium" | "high" | null } | undefined)
          ?.upgrade_potential
      ) ?? null,
      group_leader_names: seat?.group_id
        ? groupLeadersByGroupId.get(seat.group_id) ?? []
        : [],
    };
  });

  // ---- Sort: group_no → role → region_id --------------------------------
  rows.sort((a, b) => {
    const ag = a.group_no ?? Number.POSITIVE_INFINITY;
    const bg = b.group_no ?? Number.POSITIVE_INFINITY;
    if (ag !== bg) return ag - bg;
    const ar = a.role ? ROLE_PRIORITY[a.role] : ROLE_PRIORITY.participant;
    const br = b.role ? ROLE_PRIORITY[b.role] : ROLE_PRIORITY.participant;
    if (ar !== br) return ar - br;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });

  return { event, rows };
}
