import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { resolveEnrollmentPrice, PRICING_EVENT_COLUMNS, type PricingEvent } from "@/lib/pricing/resolve-server";
import { pricingDay, type PriceBasis } from "@/lib/pricing/tiers";
import { SEAT_TIER_KEY, type Seat, type SeatStatus } from "./types";

// 名额 · reward seats (migration 082). Service client + audit; callers
// check the role (Super Admin). Rules enforced here, not in the UI:
//   • a seat is for one course; it can only be used on an event of that course
//   • the recipient is never the holder (also a DB check)
//   • only a seat given to THIS enrollment's participant can be used on it
//   • using a seat → course fee 0, the 会务费 only; removing it re-prices by
//     the normal rules and puts the seat back to "given"

type Service = ReturnType<typeof createSupabaseServiceClient>;

type Row = {
  id: string;
  status: SeatStatus;
  note: string | null;
  holder_id: string;
  recipient_id: string | null;
  enrollment_id: string | null;
  issued_at: string;
  cancel_reason: string | null;
  course: { id: string; name_cn: string; name_en: string | null } | null;
  holder: { id: string; region_id: string | null; name_cn: string | null; name_en: string | null } | null;
  recipient: { id: string; region_id: string | null; name_cn: string | null; name_en: string | null } | null;
  enrollment: { id: string; event: { id: string; title_cn: string | null; title_en: string | null; start_date: string | null } | null } | null;
};

const SELECT =
  "id, status, note, holder_id, recipient_id, enrollment_id, issued_at, cancel_reason, " +
  "course:courses(id, name_cn, name_en), " +
  "holder:participants!reward_seats_holder_id_fkey(id, region_id, name_cn, name_en), " +
  "recipient:participants!reward_seats_recipient_id_fkey(id, region_id, name_cn, name_en), " +
  "enrollment:enrollments(id, event:events(id, title_cn, title_en, start_date))";

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

const person = (p: Row["holder"]) =>
  p ? { id: p.id, region_id: p.region_id, name: p.name_cn || p.name_en || "—" } : null;

function toSeat(r: Row): Seat {
  return {
    id: r.id,
    status: r.status,
    note: r.note,
    course: r.course ?? { id: "", name_cn: "—", name_en: null },
    holder: person(r.holder) ?? { id: r.holder_id, region_id: null, name: "—" },
    recipient: person(r.recipient),
    used_on:
      r.enrollment && r.enrollment.event
        ? {
            enrollment_id: r.enrollment.id,
            event_id: r.enrollment.event.id,
            title: r.enrollment.event.title_cn || r.enrollment.event.title_en || "event",
            start_date: r.enrollment.event.start_date,
          }
        : null,
    issued_at: r.issued_at,
    cancel_reason: r.cancel_reason,
  };
}

/** Seats a member holds, and seats given to them. [] before migration 082. */
export async function seatsForParticipant(
  participantId: string,
  service: Service = createSupabaseServiceClient(),
): Promise<{ held: Seat[]; received: Seat[] }> {
  const [held, received] = await Promise.all([
    service.from("reward_seats").select(SELECT).eq("holder_id", participantId).order("issued_at").returns<Row[]>(),
    service.from("reward_seats").select(SELECT).eq("recipient_id", participantId).order("issued_at").returns<Row[]>(),
  ]);
  if (held.error) {
    if (MISSING_TABLE.has(held.error.code ?? "")) return { held: [], received: [] };
    throw new Error(`seatsForParticipant: ${held.error.message}`);
  }
  return { held: (held.data ?? []).map(toSeat), received: (received.data ?? []).map(toSeat) };
}

/** For an event's enrollments page: per participant, the seats given to
 *  them for this event's course that can still be used, plus seats used
 *  on these enrollments. */
export async function seatsForEvent(
  event: { id: string; course_id: string | null },
  participantIds: string[],
  service: Service = createSupabaseServiceClient(),
): Promise<{ usable: Record<string, Seat[]>; usedByEnrollment: Record<string, Seat> }> {
  const usable: Record<string, Seat[]> = {};
  const usedByEnrollment: Record<string, Seat> = {};
  if (participantIds.length === 0) return { usable, usedByEnrollment };
  for (let i = 0; i < participantIds.length; i += 200) {
    const chunk = participantIds.slice(i, i + 200);
    const { data, error } = await service
      .from("reward_seats")
      .select(SELECT)
      .in("recipient_id", chunk)
      .in("status", ["assigned", "used"])
      .returns<Row[]>();
    if (error) {
      if (MISSING_TABLE.has(error.code ?? "")) return { usable, usedByEnrollment };
      throw new Error(`seatsForEvent: ${error.message}`);
    }
    for (const r of data ?? []) {
      const s = toSeat(r);
      if (r.status === "used" && r.enrollment_id) usedByEnrollment[r.enrollment_id] = s;
      else if (r.status === "assigned" && event.course_id && r.course?.id === event.course_id && r.recipient_id) {
        (usable[r.recipient_id] ??= []).push(s);
      }
    }
  }
  return { usable, usedByEnrollment };
}

export type SeatError = { error: string; status: number };

/** Super Admin issues seats to a member by hand. */
export async function issueSeats(
  holderId: string,
  input: { course_id: string; quantity: number; note: string | null },
  admin: AdminContext,
): Promise<{ ids?: string[] } & Partial<SeatError>> {
  const service = createSupabaseServiceClient();
  const qty = Math.max(1, Math.min(20, Math.floor(input.quantity)));
  const { data: course } = await service.from("courses").select("id, name_cn").eq("id", input.course_id).maybeSingle<{ id: string; name_cn: string }>();
  if (!course) return { error: "Course not found.", status: 400 };
  const rows = Array.from({ length: qty }, () => ({
    holder_id: holderId,
    course_id: course.id,
    note: input.note?.trim() || null,
    issued_by: admin.id,
  }));
  const { data, error } = await service.from("reward_seats").insert(rows).select("id").returns<Array<{ id: string }>>();
  if (error) throw new Error(`issueSeats: ${error.message}`);
  await writeAuditLog({
    actor_id: admin.id,
    action: "seat.issued",
    entity: "participants",
    entity_id: holderId,
    after: { course_id: course.id, course: course.name_cn, quantity: qty, note: input.note ?? null },
  });
  return { ids: (data ?? []).map((r) => r.id) };
}

async function loadSeat(service: Service, seatId: string) {
  const { data } = await service
    .from("reward_seats")
    .select("id, status, holder_id, recipient_id, enrollment_id, course_id")
    .eq("id", seatId)
    .maybeSingle<{ id: string; status: SeatStatus; holder_id: string; recipient_id: string | null; enrollment_id: string | null; course_id: string }>();
  return data;
}

/** Give / take back / cancel a seat. */
export async function updateSeat(
  seatId: string,
  patch: { action: "assign"; recipient_id: string } | { action: "unassign" } | { action: "cancel"; reason: string },
  admin: AdminContext,
): Promise<Partial<SeatError>> {
  const service = createSupabaseServiceClient();
  const seat = await loadSeat(service, seatId);
  if (!seat) return { error: "Seat not found.", status: 404 };
  if (seat.status === "used") return { error: "This 名额 is used on a registration. Remove it from the registration first.", status: 409 };
  if (seat.status === "cancelled") return { error: "This 名额 is cancelled.", status: 409 };
  const now = new Date().toISOString();

  if (patch.action === "assign") {
    if (patch.recipient_id === seat.holder_id) {
      return { error: "A 名额 can't be given to its own holder — it's for family, business partners or friends.", status: 400 };
    }
    const { error } = await service
      .from("reward_seats")
      .update({ status: "assigned", recipient_id: patch.recipient_id, assigned_at: now, updated_at: now })
      .eq("id", seatId);
    if (error) throw new Error(`assign seat: ${error.message}`);
    await writeAuditLog({ actor_id: admin.id, action: "seat.assigned", entity: "participants", entity_id: seat.holder_id, before: { seat_id: seatId, recipient_id: seat.recipient_id }, after: { seat_id: seatId, recipient_id: patch.recipient_id } });
    return {};
  }
  if (patch.action === "unassign") {
    const { error } = await service
      .from("reward_seats")
      .update({ status: "available", recipient_id: null, assigned_at: null, updated_at: now })
      .eq("id", seatId);
    if (error) throw new Error(`unassign seat: ${error.message}`);
    await writeAuditLog({ actor_id: admin.id, action: "seat.unassigned", entity: "participants", entity_id: seat.holder_id, before: { seat_id: seatId, recipient_id: seat.recipient_id } });
    return {};
  }
  const { error } = await service
    .from("reward_seats")
    .update({ status: "cancelled", cancelled_at: now, cancel_reason: patch.reason, updated_at: now })
    .eq("id", seatId);
  if (error) throw new Error(`cancel seat: ${error.message}`);
  await writeAuditLog({ actor_id: admin.id, action: "seat.cancelled", entity: "participants", entity_id: seat.holder_id, before: { seat_id: seatId, status: seat.status }, metadata: { reason: patch.reason } });
  return {};
}

type EnrollmentForSeat = {
  id: string;
  participant_id: string;
  event_id: string;
  status: string;
  price_tier_key: string | null;
  amount_due: number | string | null;
  event: (PricingEvent & { title_cn: string | null; title_en: string | null }) | null;
};

/** Use a seat on an enrollment: course fee waived, 会务费 only. */
export async function useSeat(enrollmentId: string, seatId: string, admin: AdminContext): Promise<{ amount_due?: number } & Partial<SeatError>> {
  const service = createSupabaseServiceClient();
  const { data: enr } = await service
    .from("enrollments")
    .select(`id, participant_id, event_id, status, price_tier_key, amount_due, event:events(${PRICING_EVENT_COLUMNS}, title_cn, title_en)`)
    .eq("id", enrollmentId)
    .maybeSingle<EnrollmentForSeat>();
  if (!enr || !enr.event) return { error: "Registration not found.", status: 404 };
  if (enr.status === "cancelled" || enr.status === "rejected") return { error: "This registration is cancelled or rejected.", status: 409 };
  const seat = await loadSeat(service, seatId);
  if (!seat) return { error: "Seat not found.", status: 404 };
  if (seat.status !== "assigned" || seat.recipient_id !== enr.participant_id) {
    return { error: "This 名额 hasn't been given to this person.", status: 409 };
  }
  if (!enr.event.course_id || enr.event.course_id !== seat.course_id) {
    return { error: "This 名额 is for a different course than this event.", status: 409 };
  }
  const { data: already } = await service.from("reward_seats").select("id").eq("enrollment_id", enrollmentId).maybeSingle();
  if (already) return { error: "A 名额 is already used on this registration.", status: 409 };

  const [{ data: holder }, { data: course }] = await Promise.all([
    service.from("participants").select("name_cn, name_en").eq("id", seat.holder_id).maybeSingle<{ name_cn: string | null; name_en: string | null }>(),
    service.from("courses").select("name_cn").eq("id", seat.course_id).maybeSingle<{ name_cn: string }>(),
  ]);
  const misc = Number(enr.event.misc_fee ?? 0) || 0;
  const now = new Date().toISOString();
  // Keep who they are (category / programme) in the audit snapshot; only
  // the price itself comes from the seat.
  const normal = await resolveEnrollmentPrice(enr.event, enr.participant_id, service);
  const basis: PriceBasis = {
    v: 1,
    rule: "seat",
    category: normal.price_basis.category,
    programme_slug: normal.price_basis.programme_slug,
    valid_until: normal.price_basis.valid_until,
    on_date: pricingDay(enr.event),
    course_id: enr.event.course_id,
    tier_key: SEAT_TIER_KEY,
    misc_fee: misc,
    course_fee: 0,
    amount: misc,
    seat: {
      id: seat.id,
      holder_id: seat.holder_id,
      holder_name: holder?.name_cn || holder?.name_en || "member",
      course_name: course?.name_cn ?? "course",
    },
  };

  // Claim the seat first (guarded on its current state) so two staff can't
  // use the same seat twice; then re-price the enrollment.
  const { data: claimed, error: claimErr } = await service
    .from("reward_seats")
    .update({ status: "used", enrollment_id: enrollmentId, used_at: now, updated_at: now })
    .eq("id", seatId)
    .eq("status", "assigned")
    .select("id");
  if (claimErr) throw new Error(`use seat: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return { error: "This 名额 was just used elsewhere.", status: 409 };

  const { error: updErr } = await service
    .from("enrollments")
    .update({ price_tier_key: SEAT_TIER_KEY, amount_due: misc, price_basis: basis })
    .eq("id", enrollmentId);
  if (updErr) {
    await service.from("reward_seats").update({ status: "assigned", enrollment_id: null, used_at: null, updated_at: now }).eq("id", seatId);
    throw new Error(`price with seat: ${updErr.message}`);
  }
  await writeAuditLog({
    actor_id: admin.id,
    action: "seat.used",
    entity: "enrollments",
    entity_id: enrollmentId,
    before: { price_tier_key: enr.price_tier_key, amount_due: enr.amount_due },
    after: { price_tier_key: SEAT_TIER_KEY, amount_due: misc },
    metadata: { seat_id: seat.id, holder_id: seat.holder_id, event_id: enr.event_id },
  });
  return { amount_due: misc };
}

/**
 * Take the seat off an enrollment: it goes back to "given" (assigned to the
 * same recipient) and the enrollment is re-priced by the normal rules.
 * Used by "Remove 名额" and when a registration is cancelled or rejected.
 */
export async function releaseSeat(
  enrollmentId: string,
  reason: string,
  admin: AdminContext | null,
  opts: { reprice?: boolean } = { reprice: true },
): Promise<{ released: boolean; amount_due?: number | null }> {
  const service = createSupabaseServiceClient();
  const { data: seat } = await service
    .from("reward_seats")
    .select("id, holder_id")
    .eq("enrollment_id", enrollmentId)
    .maybeSingle<{ id: string; holder_id: string }>();
  if (!seat) return { released: false };
  const now = new Date().toISOString();
  const { error } = await service
    .from("reward_seats")
    .update({ status: "assigned", enrollment_id: null, used_at: null, updated_at: now })
    .eq("id", seat.id);
  if (error) throw new Error(`release seat: ${error.message}`);

  let amount: number | null | undefined;
  if (opts.reprice !== false) {
    const { data: enr } = await service
      .from("enrollments")
      .select(`participant_id, price_tier_key, amount_due, event:events(${PRICING_EVENT_COLUMNS})`)
      .eq("id", enrollmentId)
      .maybeSingle<{ participant_id: string; price_tier_key: string | null; amount_due: number | string | null; event: PricingEvent | null }>();
    if (enr?.event) {
      const r = await resolveEnrollmentPrice(enr.event, enr.participant_id, service);
      amount = r.amount_due;
      await service
        .from("enrollments")
        .update({ price_tier_key: r.price_tier_key, amount_due: r.amount_due, price_basis: r.price_basis })
        .eq("id", enrollmentId);
    }
  }
  await writeAuditLog({
    actor_id: admin?.id ?? null,
    action: "seat.released",
    entity: "enrollments",
    entity_id: enrollmentId,
    before: { seat_id: seat.id },
    after: amount !== undefined ? { amount_due: amount } : null,
    metadata: { reason, holder_id: seat.holder_id },
  });
  return { released: true, amount_due: amount };
}
