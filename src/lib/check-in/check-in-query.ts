import "server-only";
import { createSupabaseServiceClient } from "../supabase";
import type {
  CheckInAbsentRow,
  CheckInGroupRow,
  CheckInMethod,
  CheckInRecent,
  CheckInStats,
  CheckInTimeBucket,
  CheckInVelocity,
} from "./types";

// Server-only loaders for the /admin/events/[id]/check-in page. The page
// renders an initial snapshot from these helpers then the client polls
// /stats every few seconds while the camera is active so the live count
// stays current as other staff scan in parallel.

export type CheckInPageData = {
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    capacity: number | null;
    check_in_method: "qr" | "face" | "both";
  };
  stats: CheckInStats;
  recent: CheckInRecent[];
  velocity: CheckInVelocity;
  groups: CheckInGroupRow[];
  absent: CheckInAbsentRow[];
  buckets: CheckInTimeBucket[];
};

export async function loadCheckInPage(
  eventId: string,
): Promise<CheckInPageData | null> {
  const supabase = createSupabaseServiceClient();

  // M7.1d — `check_in_method` was added in migration 036. Fall back to
  // 'face' when the column isn't present yet (defensive against migration
  // drift on freshly-cloned environments).
  let event:
    | (Record<string, unknown> & { id: string; check_in_method?: string })
    | null = null;
  {
    const primary = await supabase
      .from("events")
      .select(
        "id, slug, title_en, title_cn, start_date, end_date, capacity, check_in_method",
      )
      .eq("id", eventId)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      const fallback = await supabase
        .from("events")
        .select("id, slug, title_en, title_cn, start_date, end_date, capacity")
        .eq("id", eventId)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      event = fallback.data
        ? { ...fallback.data, check_in_method: "face" }
        : null;
    } else {
      event = primary.data;
    }
  }
  if (!event) return null;
  const eventTyped = {
    id: event.id as string,
    slug: event.slug as string,
    title_en: (event.title_en as string | null) ?? null,
    title_cn: (event.title_cn as string | null) ?? null,
    start_date: (event.start_date as string | null) ?? null,
    end_date: (event.end_date as string | null) ?? null,
    capacity: (event.capacity as number | null) ?? null,
    check_in_method:
      (event.check_in_method as "qr" | "face" | "both" | null) ?? "face",
  };

  const [stats, recent, velocity, groups, absent, buckets] = await Promise.all([
    loadStats(eventId),
    loadRecent(eventId, 20),
    loadVelocity(eventId),
    loadGroupRoster(eventId),
    loadAbsentees(eventId, 50),
    loadArrivalBuckets(eventId, 120, 5),
  ]);

  return { event: eventTyped, stats, recent, velocity, groups, absent, buckets };
}

export async function loadStats(eventId: string): Promise<CheckInStats> {
  const supabase = createSupabaseServiceClient();

  // Eligible = enrollments that have at least made it past approval. We
  // count both approved + paid so admin sees the right denominator even
  // if some attendees pay at the door.
  const { data: eligibleRows, error: eligibleErr } = await supabase
    .from("enrollments")
    .select("id, status, payment_status")
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"]);
  if (eligibleErr) throw new Error(eligibleErr.message);
  const total_eligible = eligibleRows?.length ?? 0;

  const { data: methodRows, error: methodErr } = await supabase
    .from("check_ins")
    .select("method")
    .eq("event_id", eventId);
  if (methodErr) throw new Error(methodErr.message);

  let qr = 0;
  let manual = 0;
  let face_match = 0;
  for (const row of methodRows ?? []) {
    const m = (row as { method: CheckInMethod }).method;
    if (m === "qr") qr += 1;
    else if (m === "face_match") face_match += 1;
    else manual += 1;
  }

  return {
    total_eligible,
    total_checked_in: qr + manual + face_match,
    by_method: { qr, manual, face_match },
  };
}

export async function loadRecent(
  eventId: string,
  limit = 20,
): Promise<CheckInRecent[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("check_ins")
    .select(
      "enrollment_id, participant_id, checked_in_at, method, " +
        "participants!inner(region_id, name_cn, name_en)",
    )
    .eq("event_id", eventId)
    .order("checked_in_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  // We compute group_no in a follow-up query rather than threading another
  // join through PostgREST (cheaper than nesting another !inner).
  const participantIds = (data ?? []).map(
    (r) => (r as unknown as { participant_id: string }).participant_id,
  );
  const groupByParticipant = new Map<string, number | null>();
  if (participantIds.length > 0) {
    const { data: seats, error: seatErr } = await supabase
      .from("event_seat_assignments")
      .select("participant_id, event_groups!inner(group_no)")
      .eq("event_id", eventId)
      .in("participant_id", participantIds);
    if (seatErr) throw new Error(seatErr.message);
    for (const s of seats ?? []) {
      const row = s as unknown as {
        participant_id: string;
        event_groups: { group_no: number | null } | null;
      };
      groupByParticipant.set(
        row.participant_id,
        row.event_groups?.group_no ?? null,
      );
    }
  }

  return (data ?? []).map((r) => {
    const row = r as unknown as {
      enrollment_id: string;
      participant_id: string;
      checked_in_at: string;
      method: CheckInMethod;
      participants: {
        region_id: string | null;
        name_cn: string | null;
        name_en: string | null;
      };
    };
    return {
      enrollment_id: row.enrollment_id,
      participant_id: row.participant_id,
      region_id: row.participants.region_id,
      name_cn: row.participants.name_cn,
      name_en: row.participants.name_en,
      group_no: groupByParticipant.get(row.participant_id) ?? null,
      checked_in_at: row.checked_in_at,
      method: row.method,
    };
  });
}

// Manual-search typeahead — admin types a region_id fragment or name and
// gets back the 20 best matches scoped to this event's eligible enrolments
// (approved + paid). Already-checked-in rows are returned too so admin can
// confirm + optionally undo.
export type ManualSearchRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
  checked_in_at: string | null;
  check_in_id: string | null;
  // M7.1d — surface enrollment-readiness signals so the scanner can
  // decide whether to offer the "Capture & enroll" on-spot flow.
  has_photo: boolean;
  has_embedding: boolean;
  consented: boolean;
};

export async function searchEligibleForCheckIn(
  eventId: string,
  query: string,
): Promise<ManualSearchRow[]> {
  const supabase = createSupabaseServiceClient();
  const q = query.trim();

  let req = supabase
    .from("enrollments")
    .select(
      "id, participant_id, status, payment_status, " +
        "participants!inner(region_id, name_cn, name_en, phone, front_photo_url, facial_recognition_consent, face_embedding)",
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .limit(30);

  if (q.length > 0) {
    const safe = q.replace(/[\\%_,]/g, "\\$&");
    req = req.or(
      [
        `region_id.ilike.%${safe}%`,
        `name_cn.ilike.%${safe}%`,
        `name_en.ilike.%${safe}%`,
        `phone.ilike.%${safe}%`,
      ].join(","),
      { referencedTable: "participants" },
    );
  }

  const { data, error } = await req;
  if (error) throw new Error(error.message);

  const participantIds = (data ?? []).map(
    (r) => (r as unknown as { participant_id: string }).participant_id,
  );

  const [{ data: checkIns }, { data: seats }] = await Promise.all([
    supabase
      .from("check_ins")
      .select("id, enrollment_id, checked_in_at")
      .eq("event_id", eventId)
      .in(
        "enrollment_id",
        (data ?? []).map((r) => (r as unknown as { id: string }).id),
      ),
    participantIds.length === 0
      ? Promise.resolve({ data: [] as unknown[] })
      : supabase
          .from("event_seat_assignments")
          .select("participant_id, event_groups!inner(group_no)")
          .eq("event_id", eventId)
          .in("participant_id", participantIds),
  ]);

  const checkInByEnrolment = new Map<
    string,
    { id: string; checked_in_at: string }
  >();
  for (const c of checkIns ?? []) {
    const row = c as { id: string; enrollment_id: string; checked_in_at: string };
    checkInByEnrolment.set(row.enrollment_id, {
      id: row.id,
      checked_in_at: row.checked_in_at,
    });
  }

  const groupByParticipant = new Map<string, number | null>();
  for (const s of seats ?? []) {
    const row = s as unknown as {
      participant_id: string;
      event_groups: { group_no: number | null } | null;
    };
    groupByParticipant.set(
      row.participant_id,
      row.event_groups?.group_no ?? null,
    );
  }

  return (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      participant_id: string;
      participants: {
        region_id: string | null;
        name_cn: string | null;
        name_en: string | null;
        phone: string | null;
        front_photo_url: string | null;
        facial_recognition_consent: boolean;
        face_embedding: number[] | null;
      };
    };
    const checkIn = checkInByEnrolment.get(row.id) ?? null;
    return {
      enrollment_id: row.id,
      participant_id: row.participant_id,
      region_id: row.participants.region_id,
      name_cn: row.participants.name_cn,
      name_en: row.participants.name_en,
      phone: row.participants.phone,
      group_no: groupByParticipant.get(row.participant_id) ?? null,
      checked_in_at: checkIn?.checked_in_at ?? null,
      check_in_id: checkIn?.id ?? null,
      has_photo: row.participants.front_photo_url !== null,
      has_embedding:
        row.participants.face_embedding !== null &&
        (row.participants.face_embedding?.length ?? 0) > 0,
      consented: row.participants.facial_recognition_consent === true,
    };
  });
}

// Lightweight loader for the public ticket page — given a QR token,
// returns the enrollment + participant + event details so we can render
// the ticket card and the QR PNG. Returns null if the token doesn't
// match anything (caller renders a 404).
export async function loadTicketByToken(token: string): Promise<{
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    city: string | null;
  };
  participant: {
    id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
  };
  enrollment: {
    id: string;
    qr_token: string;
    status: string;
    payment_status: string;
  };
  check_in: {
    checked_in_at: string;
    method: CheckInMethod;
  } | null;
} | null> {
  if (!token) return null;
  const supabase = createSupabaseServiceClient();
  const { data: enrolment, error } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, participant_id, qr_token, status, payment_status, " +
        "events!inner(id, slug, title_en, title_cn, start_date, end_date, venue, city), " +
        "participants!inner(id, region_id, name_cn, name_en)",
    )
    .eq("qr_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!enrolment) return null;
  const row = enrolment as unknown as {
    id: string;
    qr_token: string;
    status: string;
    payment_status: string;
    events: {
      id: string;
      slug: string;
      title_en: string | null;
      title_cn: string | null;
      start_date: string | null;
      end_date: string | null;
      venue: string | null;
      city: string | null;
    };
    participants: {
      id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
    };
  };

  const { data: existing } = await supabase
    .from("check_ins")
    .select("checked_in_at, method")
    .eq("enrollment_id", row.id)
    .maybeSingle();

  return {
    event: row.events,
    participant: row.participants,
    enrollment: {
      id: row.id,
      qr_token: row.qr_token,
      status: row.status,
      payment_status: row.payment_status,
    },
    check_in: existing
      ? {
          checked_in_at: (existing as { checked_in_at: string }).checked_in_at,
          method: (existing as { method: CheckInMethod }).method,
        }
      : null,
  };
}

// --- M7.1b richer dashboard loaders -----------------------------------------

// Velocity = rolling 15-min + 60-min check-in counts. ETA = projected
// completion based on the 15-min rate (more responsive than the 60-min
// rate, which lags behind a fast-finishing door).
export async function loadVelocity(eventId: string): Promise<CheckInVelocity> {
  const supabase = createSupabaseServiceClient();
  const now = Date.now();
  const fifteenAgo = new Date(now - 15 * 60 * 1000).toISOString();
  const sixtyAgo = new Date(now - 60 * 60 * 1000).toISOString();

  const [{ count: c15, error: e15 }, { count: c60, error: e60 }] =
    await Promise.all([
      supabase
        .from("check_ins")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .gte("checked_in_at", fifteenAgo),
      supabase
        .from("check_ins")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .gte("checked_in_at", sixtyAgo),
    ]);
  if (e15) throw new Error(e15.message);
  if (e60) throw new Error(e60.message);

  const last_15min = c15 ?? 0;
  const last_60min = c60 ?? 0;

  // ETA needs the still-outstanding count + a rate. Reuse loadStats's
  // numbers — extra Promise.all-friendly call adds < 2ms.
  const stats = await loadStats(eventId);
  const remaining = stats.total_eligible - stats.total_checked_in;

  let eta_iso: string | null = null;
  if (remaining > 0 && last_15min > 0) {
    const ratePerMin = last_15min / 15;
    const minsToFull = Math.ceil(remaining / ratePerMin);
    if (Number.isFinite(minsToFull) && minsToFull < 60 * 24) {
      eta_iso = new Date(now + minsToFull * 60 * 1000).toISOString();
    }
  }

  return { last_15min, last_60min, eta_iso };
}

// Per-group completion grid. One row per event_groups row, plus a synthetic
// "Ungrouped" row aggregating paid enrolments without a seat assignment so
// they don't disappear from the dashboard.
export async function loadGroupRoster(
  eventId: string,
): Promise<CheckInGroupRow[]> {
  const supabase = createSupabaseServiceClient();

  const [
    { data: groups, error: groupErr },
    { data: assignments, error: assignErr },
    { data: paid, error: paidErr },
    { data: checkIns, error: checkErr },
  ] = await Promise.all([
    supabase
      .from("event_groups")
      .select("id, group_no, group_class, name_en, name_cn")
      .eq("event_id", eventId)
      .order("group_no", { ascending: true }),
    supabase
      .from("event_seat_assignments")
      .select("group_id, participant_id")
      .eq("event_id", eventId)
      .not("group_id", "is", null),
    supabase
      .from("enrollments")
      .select("id, participant_id, status, payment_status")
      .eq("event_id", eventId)
      .or("status.eq.paid,status.eq.approved"),
    supabase
      .from("check_ins")
      .select("participant_id")
      .eq("event_id", eventId),
  ]);
  if (groupErr) throw new Error(groupErr.message);
  if (assignErr) throw new Error(assignErr.message);
  if (paidErr) throw new Error(paidErr.message);
  if (checkErr) throw new Error(checkErr.message);

  type AssignRow = { group_id: string | null; participant_id: string };
  type PaidRow = { participant_id: string };
  type CheckRow = { participant_id: string };

  const checkedSet = new Set<string>(
    ((checkIns ?? []) as CheckRow[]).map((c) => c.participant_id),
  );

  // Build participant → group_id map from event_seat_assignments.
  const groupByParticipant = new Map<string, string>();
  for (const a of (assignments ?? []) as AssignRow[]) {
    if (a.group_id) groupByParticipant.set(a.participant_id, a.group_id);
  }

  // Tally expected + checked-in counts per group_id.
  const expectedPerGroup = new Map<string, number>();
  const checkedPerGroup = new Map<string, number>();
  let ungroupedExpected = 0;
  let ungroupedChecked = 0;

  for (const e of (paid ?? []) as PaidRow[]) {
    const gid = groupByParticipant.get(e.participant_id);
    const isChecked = checkedSet.has(e.participant_id);
    if (gid) {
      expectedPerGroup.set(gid, (expectedPerGroup.get(gid) ?? 0) + 1);
      if (isChecked) {
        checkedPerGroup.set(gid, (checkedPerGroup.get(gid) ?? 0) + 1);
      }
    } else {
      ungroupedExpected += 1;
      if (isChecked) ungroupedChecked += 1;
    }
  }

  type GroupRow = {
    id: string;
    group_no: number | null;
    group_class: string | null;
    name_en: string | null;
    name_cn: string | null;
  };

  const rows: CheckInGroupRow[] = ((groups ?? []) as GroupRow[]).map((g) => ({
    group_id: g.id,
    group_no: g.group_no,
    group_class: g.group_class,
    name_en: g.name_en,
    name_cn: g.name_cn,
    expected_count: expectedPerGroup.get(g.id) ?? 0,
    checked_in_count: checkedPerGroup.get(g.id) ?? 0,
  }));

  if (ungroupedExpected > 0) {
    rows.push({
      group_id: "__ungrouped",
      group_no: null,
      group_class: null,
      name_en: "Ungrouped",
      name_cn: "未分组",
      expected_count: ungroupedExpected,
      checked_in_count: ungroupedChecked,
    });
  }

  return rows;
}

// Paid attendees who haven't checked in yet. Sorted by group_no asc nulls
// last so the door staff can phone groups together. Limit is 50 by default
// for the dashboard; the full list lives elsewhere.
export async function loadAbsentees(
  eventId: string,
  limit = 50,
): Promise<CheckInAbsentRow[]> {
  const supabase = createSupabaseServiceClient();

  const [
    { data: eligible, error: eligErr },
    { data: checked, error: checkErr },
    { data: assignments, error: assignErr },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        "id, participant_id, participant:participants!inner(region_id, name_cn, name_en, phone)",
      )
      .eq("event_id", eventId)
      .or("status.eq.paid,status.eq.approved"),
    supabase
      .from("check_ins")
      .select("participant_id")
      .eq("event_id", eventId),
    supabase
      .from("event_seat_assignments")
      .select("participant_id, event_groups!inner(group_no)")
      .eq("event_id", eventId),
  ]);
  if (eligErr) throw new Error(eligErr.message);
  if (checkErr) throw new Error(checkErr.message);
  if (assignErr) throw new Error(assignErr.message);

  type EligRow = {
    id: string;
    participant_id: string;
    participant: {
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      phone: string | null;
    } | null;
  };
  type CheckRow = { participant_id: string };
  type AssignRow = {
    participant_id: string;
    event_groups: { group_no: number | null } | null;
  };

  const checkedSet = new Set<string>(
    ((checked ?? []) as CheckRow[]).map((c) => c.participant_id),
  );
  const groupNoByParticipant = new Map<string, number | null>();
  for (const a of (assignments ?? []) as unknown as AssignRow[]) {
    groupNoByParticipant.set(
      a.participant_id,
      a.event_groups?.group_no ?? null,
    );
  }

  const absent: CheckInAbsentRow[] = [];
  for (const e of (eligible ?? []) as unknown as EligRow[]) {
    if (checkedSet.has(e.participant_id)) continue;
    if (!e.participant) continue;
    absent.push({
      enrollment_id: e.id,
      participant_id: e.participant_id,
      region_id: e.participant.region_id,
      name_cn: e.participant.name_cn,
      name_en: e.participant.name_en,
      phone: e.participant.phone,
      group_no: groupNoByParticipant.get(e.participant_id) ?? null,
    });
  }

  absent.sort((a, b) => {
    // group_no asc, nulls last
    if (a.group_no !== b.group_no) {
      if (a.group_no === null) return 1;
      if (b.group_no === null) return -1;
      return a.group_no - b.group_no;
    }
    const an = a.name_cn ?? a.name_en ?? "";
    const bn = b.name_cn ?? b.name_en ?? "";
    return an.localeCompare(bn);
  });

  return absent.slice(0, limit);
}

// Bucketed arrival time-series for the sparkline. Default = last 120 min,
// 5-min buckets. Empty buckets are emitted so the SVG has a continuous X
// axis. Bucket alignment uses the floor of (now - minutes) to the nearest
// bucketMinutes boundary, so successive polls give stable bucket starts.
export async function loadArrivalBuckets(
  eventId: string,
  minutes = 120,
  bucketMinutes = 5,
): Promise<CheckInTimeBucket[]> {
  const supabase = createSupabaseServiceClient();
  const now = Date.now();
  const sinceMs = now - minutes * 60 * 1000;
  const since = new Date(sinceMs).toISOString();

  const { data, error } = await supabase
    .from("check_ins")
    .select("checked_in_at")
    .eq("event_id", eventId)
    .gte("checked_in_at", since)
    .order("checked_in_at", { ascending: true });
  if (error) throw new Error(error.message);

  const bucketMs = bucketMinutes * 60 * 1000;
  const startBucket = Math.floor(sinceMs / bucketMs) * bucketMs;
  const totalBuckets = Math.ceil((now - startBucket) / bucketMs) + 1;

  const counts: number[] = new Array(totalBuckets).fill(0);
  for (const row of (data ?? []) as { checked_in_at: string }[]) {
    const t = new Date(row.checked_in_at).getTime();
    const idx = Math.floor((t - startBucket) / bucketMs);
    if (idx >= 0 && idx < totalBuckets) counts[idx] += 1;
  }

  return counts.map((count, i) => ({
    bucket_start: new Date(startBucket + i * bucketMs).toISOString(),
    count,
  }));
}
