import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import {
  isProgrammeCategory,
  participantPriceCategory,
  resolvePrice,
  sgDay,
  validUntilDay,
  type ParticipantLike,
  type PriceBasis,
  type PriceTier,
} from "./tiers";

// THE place that prices an enrollment. Every path (public register, /me
// register, admin add, recruit leads, the register page preview, the
// enrollments "Price check") loads the participant facts here and runs the
// same pure rule (resolvePrice in tiers.ts), so they can never disagree.

export type PricingEvent = {
  id: string;
  price?: number | string | null;
  price_tiers?: PriceTier[] | null;
  misc_fee?: number | string | null;
  course_id?: string | null;
  start_date?: string | null;
};

/** The event columns pricing needs, for `.select(...)`. */
export const PRICING_EVENT_COLUMNS = "id, price, price_tiers, misc_fee, course_id, start_date";

type Service = ReturnType<typeof createSupabaseServiceClient>;

type ParticipantRow = {
  id: string;
  is_old_student: boolean | null;
  attended_courses: Array<{ course_name?: string | null; course_id?: string | null; date?: string | null }> | null;
  programme_id: string | null;
  programme_expires_at: string | null;
  programmes: { slug: string | null } | { slug: string | null }[] | null;
};

/** Load the pricing facts for many participants against one event. */
export async function loadPricingParticipants(
  event: PricingEvent,
  participantIds: string[],
  service: Service = createSupabaseServiceClient(),
): Promise<Map<string, ParticipantLike>> {
  const out = new Map<string, ParticipantLike>();
  const ids = [...new Set(participantIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const rows: ParticipantRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await service
      .from("participants")
      .select("id, is_old_student, attended_courses, programme_id, programme_expires_at, programmes(slug)")
      .in("id", ids.slice(i, i + 200))
      .returns<ParticipantRow[]>();
    if (error) throw new Error(`pricing participants: ${error.message}`);
    rows.push(...(data ?? []));
  }

  // Attended before = checked in at ANOTHER event.
  const attended = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await service
      .from("check_ins")
      .select("participant_id")
      .in("participant_id", ids.slice(i, i + 200))
      .neq("event_id", event.id)
      .returns<Array<{ participant_id: string }>>();
    for (const r of data ?? []) attended.add(r.participant_id);
  }

  // Taken this course before (picks a tier's 复训 price). Exact matches
  // only, so a 复训 price is never given on a guess:
  //   • checked in at another run of the same course (events.course_id), or
  //   • an attended-courses entry LINKED to this course (course_id).
  // Typed "Other" entries without a link never count.
  const tookCourse = new Map<string, string>(); // participant → evidence
  if (event.course_id) {
    const { data: runs } = await service
      .from("events")
      .select("id, title_cn, title_en, start_date")
      .eq("course_id", event.course_id)
      .neq("id", event.id)
      .returns<Array<{ id: string; title_cn: string | null; title_en: string | null; start_date: string | null }>>();
    const runById = new Map((runs ?? []).map((r) => [r.id, r]));
    if (runById.size > 0) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await service
          .from("check_ins")
          .select("participant_id, event_id")
          .in("participant_id", ids.slice(i, i + 200))
          .in("event_id", [...runById.keys()])
          .returns<Array<{ participant_id: string; event_id: string }>>();
        for (const r of data ?? []) {
          const run = runById.get(r.event_id);
          const label = run ? `${run.title_cn || run.title_en || "earlier run"}${run.start_date ? ` ${run.start_date}` : ""}` : "earlier run";
          tookCourse.set(r.participant_id, `checked in at ${label}`);
        }
      }
    }
    for (const r of rows) {
      if (tookCourse.has(r.id)) continue;
      const hit = (r.attended_courses ?? []).find((a) => a?.course_id === event.course_id);
      if (hit) tookCourse.set(r.id, `course history: ${hit.course_name ?? "course"}${hit.date ? ` ${hit.date}` : ""}`);
    }
  }

  for (const r of rows) {
    const prog = Array.isArray(r.programmes) ? r.programmes[0] : r.programmes;
    out.set(r.id, {
      programme_slug: prog?.slug ?? null,
      programme_expires_at: r.programme_expires_at,
      is_old_student: r.is_old_student,
      has_attended: attended.has(r.id),
      has_taken_course: tookCourse.has(r.id),
      taken_course_via: tookCourse.get(r.id) ?? null,
    });
  }
  return out;
}

/**
 * Price one participant (or an unknown guest when participantId is null)
 * for an event. Returns what to store on the enrollment.
 */
export async function resolveEnrollmentPrice(
  event: PricingEvent,
  participantId: string | null,
  service: Service = createSupabaseServiceClient(),
): Promise<{ price_tier_key: string | null; amount_due: number | null; price_basis: PriceBasis }> {
  const p = participantId ? (await loadPricingParticipants(event, [participantId], service)).get(participantId) ?? null : null;
  const r = resolvePrice(event, p);
  return { price_tier_key: r.tier_key, amount_due: r.amount, price_basis: r.basis };
}

const NO_EVENT = "00000000-0000-0000-0000-000000000000";



/**
 * How pricing sees a participant today, in words, for the participant
 * page — same rule as checkout (participantPriceCategory), so staff see
 * exactly what pricing will see.
 */
export async function describePriceCategory(
  participantId: string,
  service: Service = createSupabaseServiceClient(),
): Promise<string> {
  const p = (await loadPricingParticipants({ id: NO_EVENT }, [participantId], service)).get(participantId);
  if (!p) return "—";
  const today = sgDay();
  const cat = participantPriceCategory(p, today);
  const until = validUntilDay(p.programme_expires_at);
  let name = p.programme_slug ?? "";
  if (p.programme_slug) {
    const { data } = await service.from("programmes").select("name_cn").eq("slug", p.programme_slug).maybeSingle<{ name_cn: string }>();
    name = data?.name_cn ?? p.programme_slug;
  }
  if (cat === "classic_member") return `经典永流传 · Classic member — ${name} expired ${until}`;
  if (isProgrammeCategory(cat)) {
    return until
      ? `${name} member until ${until}, then 经典永流传`
      : `${name} member (no expiry)`;
  }
  if (cat === "returning_student") {
    return `老学员 · Returning — ${p.has_attended ? "checked in at a past event" : "attended before the CRM"}`;
  }
  return "新人 · New — no programme, no past check-in";
}
