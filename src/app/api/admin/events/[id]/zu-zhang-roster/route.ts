import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { computeRosterShortfalls } from "@/lib/grouping/balance";
import {
  participantToClass,
  type GroupClass,
  type GrowthDimension,
  type StudentQualification,
  type ZuZhangCoreTrait,
  type ZuZhangTier,
} from "@/lib/grouping/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// CurateZuZhangDialog backing route. Two operations:
//
//   GET — returns the candidate list (anyone enrolled with a global tier
//         OR already serving for this event) plus a per-class shortfall
//         preview computed from the current member distribution.
//
//   POST — batch updates to enrollments.serving_as_zu_zhang +
//          zu_zhang_tier_for_event + zu_zhang_grade_for_event for many
//          rows at once. Single audit entry summarising the diff.
//
// Reads are scope-checked via the server client; writes go through the
// service client (mirrors /api/admin/enrollments/[id]/route.ts).

type RouteCtx = { params: Promise<{ id: string }> };

type CandidateRow = {
  id: string;
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  status: string;
  serving_as_zu_zhang: boolean | null;
  zu_zhang_tier_for_event: ZuZhangTier | null;
  zu_zhang_grade_for_event: number | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    financial_score: number | null;
    influence_score: number | null;
    is_old_student: boolean;
    student_qualification: StudentQualification | null;
    zu_zhang_tier: ZuZhangTier | null;
    zu_zhang_grade: number | null;
    zu_zhang_dimensions: GrowthDimension[] | null;
    zu_zhang_core_traits: ZuZhangCoreTrait[] | null;
    has_special_contribution: boolean | null;
    times_led_groups: number | null;
  } | null;
};

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can curate the 组长 roster" },
      { status: 403 },
    );
  }
  const { id: eventId } = await params;

  const supabase = await createSupabaseServerClient();

  // Pull every approved/paid enrolment with the participant's 组长
  // metadata. Filter to candidates client-side: anyone with a global
  // tier OR currently serving (so admin can clear a stale flag).
  const { data: rows, error } = await supabase
    .from("enrollments")
    .select(
      `id, participant_id, status,
       serving_as_zu_zhang, zu_zhang_tier_for_event, zu_zhang_grade_for_event,
       participant:participants!inner(
         id, region_id, name_en, name_cn,
         financial_score, influence_score, is_old_student,
         student_qualification,
         zu_zhang_tier, zu_zhang_grade, zu_zhang_dimensions,
         zu_zhang_core_traits, has_special_contribution, times_led_groups
       )`,
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .returns<CandidateRow[]>();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enrolments = (rows ?? []).filter((r) => r.participant);
  const candidates = enrolments.filter((r) => {
    const globalTier = r.participant?.zu_zhang_tier ?? null;
    const overrideTier = r.zu_zhang_tier_for_event;
    return Boolean(globalTier || overrideTier || r.serving_as_zu_zhang);
  });

  // Per-class member demand drives the shortfall preview. Class derived
  // from each enrolled participant's effective qualification.
  const memberCountByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const e of enrolments) {
    const p = e.participant!;
    const cls = participantToClass({
      financial_score: p.financial_score,
      influence_score: p.influence_score,
      student_qualification_override: p.student_qualification,
    });
    memberCountByClass[cls] += 1;
  }

  // Use the configured group_size_max to compute k_class. Fall back to
  // 12 if event row is missing/unreachable — diagnostic only.
  const { data: eventRow } = await supabase
    .from("events")
    .select("group_size_max")
    .eq("id", eventId)
    .maybeSingle<{ group_size_max: number | null }>();
  const groupSizeMax = eventRow?.group_size_max ?? 12;
  const regularCapacity = Math.max(1, groupSizeMax - 2);
  const kByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };
  for (const cls of ["strategic", "key", "growth", "maintenance"] as GroupClass[]) {
    if (memberCountByClass[cls] === 0) continue;
    kByClass[cls] = Math.ceil(memberCountByClass[cls] / regularCapacity);
  }

  // Build the roster-as-it-stands so computeRosterShortfalls reflects
  // the CURRENT state (admin sees what they need to fix).
  const currentRoster = candidates
    .filter((r) => r.serving_as_zu_zhang)
    .map((r) => {
      const tier =
        r.zu_zhang_tier_for_event ?? r.participant?.zu_zhang_tier ?? null;
      if (!tier) return null;
      const grade =
        r.zu_zhang_grade_for_event ?? r.participant?.zu_zhang_grade ?? null;
      return {
        participant_id: r.participant_id,
        region_id: r.participant?.region_id ?? null,
        tier,
        grade,
        dimensions: r.participant?.zu_zhang_dimensions ?? [],
        core_traits: r.participant?.zu_zhang_core_traits ?? [],
        is_main:
          tier === "key_recruitment"
          || tier === "recruitment"
          || tier === "maintenance",
        is_auxiliary: tier === "auxiliary",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const shortfalls = computeRosterShortfalls(currentRoster, kByClass);

  return NextResponse.json({
    candidates: candidates.map((r) => ({
      enrollment_id: r.id,
      participant_id: r.participant_id,
      region_id: r.participant?.region_id ?? null,
      name_en: r.participant?.name_en ?? null,
      name_cn: r.participant?.name_cn ?? null,
      status: r.status,
      serving_as_zu_zhang: r.serving_as_zu_zhang ?? false,
      zu_zhang_tier_for_event: r.zu_zhang_tier_for_event ?? null,
      zu_zhang_grade_for_event: r.zu_zhang_grade_for_event ?? null,
      global_tier: r.participant?.zu_zhang_tier ?? null,
      global_grade: r.participant?.zu_zhang_grade ?? null,
      financial_score: r.participant?.financial_score ?? null,
      influence_score: r.participant?.influence_score ?? null,
      is_old_student: r.participant?.is_old_student ?? false,
      qualification: r.participant?.student_qualification ?? null,
      dimensions: r.participant?.zu_zhang_dimensions ?? [],
      core_traits: r.participant?.zu_zhang_core_traits ?? [],
      has_special_contribution: r.participant?.has_special_contribution ?? false,
      times_led_groups: r.participant?.times_led_groups ?? 0,
    })),
    member_count_by_class: memberCountByClass,
    k_by_class: kByClass,
    shortfalls,
  });
}

const PostBody = z.object({
  changes: z
    .array(
      z.object({
        enrollment_id: z.string().uuid(),
        serving_as_zu_zhang: z.boolean().optional(),
        zu_zhang_tier_for_event: z
          .enum(["key_recruitment", "recruitment", "maintenance", "auxiliary"])
          .nullable()
          .optional(),
        zu_zhang_grade_for_event: z
          .number()
          .int()
          .min(1)
          .max(5)
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can curate the 组长 roster" },
      { status: 403 },
    );
  }
  const { id: eventId } = await params;

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Authoritative load: confirm every enrollment_id belongs to this
  // event before we touch anything. Also captures before-state for the
  // audit metadata.
  const enrollmentIds = body.changes.map((c) => c.enrollment_id);
  const { data: existing, error: loadErr } = await service
    .from("enrollments")
    .select(
      "id, event_id, serving_as_zu_zhang, zu_zhang_tier_for_event, zu_zhang_grade_for_event",
    )
    .in("id", enrollmentIds);
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  const byId = new Map(
    (existing ?? []).map((r) => [r.id as string, r]),
  );
  for (const c of body.changes) {
    const row = byId.get(c.enrollment_id);
    if (!row || row.event_id !== eventId) {
      return NextResponse.json(
        { error: `enrollment ${c.enrollment_id} not in this event` },
        { status: 400 },
      );
    }
  }

  // Apply each change. We update one row at a time so the per-row
  // service client errors propagate cleanly. Volume is small (one
  // event's roster — typically <50 rows).
  const applied: Array<{
    enrollment_id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];
  for (const c of body.changes) {
    const before = byId.get(c.enrollment_id)!;
    const update: Record<string, unknown> = {};
    if (c.serving_as_zu_zhang !== undefined) {
      update.serving_as_zu_zhang = c.serving_as_zu_zhang;
      // Off → clear per-event overrides so a later flip-on starts from
      // the participant's globals (mirrors the per-row chip behavior).
      if (c.serving_as_zu_zhang === false) {
        update.zu_zhang_tier_for_event = null;
        update.zu_zhang_grade_for_event = null;
      }
    }
    if (c.zu_zhang_tier_for_event !== undefined) {
      update.zu_zhang_tier_for_event = c.zu_zhang_tier_for_event;
    }
    if (c.zu_zhang_grade_for_event !== undefined) {
      update.zu_zhang_grade_for_event = c.zu_zhang_grade_for_event;
    }
    if (Object.keys(update).length === 0) continue;

    const { error: updErr } = await service
      .from("enrollments")
      .update(update)
      .eq("id", c.enrollment_id);
    if (updErr) {
      return NextResponse.json(
        {
          error: `Failed updating ${c.enrollment_id}: ${updErr.message}`,
          partial: applied.length,
        },
        { status: 500 },
      );
    }
    applied.push({
      enrollment_id: c.enrollment_id,
      before: {
        serving_as_zu_zhang: before.serving_as_zu_zhang ?? false,
        zu_zhang_tier_for_event: before.zu_zhang_tier_for_event ?? null,
        zu_zhang_grade_for_event: before.zu_zhang_grade_for_event ?? null,
      },
      after: {
        serving_as_zu_zhang:
          c.serving_as_zu_zhang ?? before.serving_as_zu_zhang ?? false,
        zu_zhang_tier_for_event:
          c.serving_as_zu_zhang === false
            ? null
            : c.zu_zhang_tier_for_event ?? before.zu_zhang_tier_for_event ?? null,
        zu_zhang_grade_for_event:
          c.serving_as_zu_zhang === false
            ? null
            : c.zu_zhang_grade_for_event
              ?? before.zu_zhang_grade_for_event
              ?? null,
      },
    });
  }

  if (applied.length > 0) {
    await writeAuditLog({
      actor_id: admin.id,
      action: "event.zu_zhang_roster_changed",
      entity: "events",
      entity_id: eventId,
      metadata: {
        via: "curate_dialog",
        changes_count: applied.length,
        changes: applied,
      },
    });
  }

  return NextResponse.json({ ok: true, applied: applied.length });
}
