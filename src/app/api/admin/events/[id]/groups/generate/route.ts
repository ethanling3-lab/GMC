import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadGroupingInputs } from "@/lib/grouping/load";
import { balance } from "@/lib/grouping/balance";
import { cushionRank } from "@/lib/grouping/cushion-rank";
import { persistGroupingResult } from "@/lib/grouping/persist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/groups/generate
//
// Branches on events.seating_mode:
//   * tables   → balance.ts (M6.2 swaps in LLM as primary path with
//                balance.ts as the fallback)
//   * cushions → cushion-rank.ts (no LLM ever — pure ranking)
//
// Idempotent: previous event_groups + event_seat_assignments are wiped
// before the new state lands. Super-admin gated because LLM cost will
// land here in M6.2; gating now keeps the surface consistent.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  // Use a server (cookie-aware) client for RLS-safe reads; service
  // client for the persist step which needs to bypass RLS for the
  // delete + insert sequence.
  const supabase = await createSupabaseServerClient();
  const inputs = await loadGroupingInputs(supabase, eventId);
  if ("error" in inputs) {
    if (inputs.error === "event_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: inputs.error }, { status: 500 });
  }

  if (inputs.participants.length === 0) {
    return NextResponse.json(
      {
        error: "no_enrolments",
        detail: "Approve or mark-paid at least one enrolment before generating groups.",
      },
      { status: 409 },
    );
  }

  const startedAt = Date.now();

  const result =
    inputs.event.seating_mode === "cushions"
      ? cushionRank({
          participants: inputs.participants,
          cushions: inputs.cushions,
        })
      : balance(inputs.participants, inputs.event.config);

  // Cushion mode requires shapes to exist before generate is meaningful.
  if (
    inputs.event.seating_mode === "cushions"
    && inputs.cushions.length === 0
  ) {
    return NextResponse.json(
      {
        error: "no_cushions_drawn",
        detail:
          "Lay out cushion shapes in the floor plan editor before generating cushion-mode seating.",
      },
      { status: 409 },
    );
  }

  // Validate the generated result has at least one assignment when there
  // were participants to seat — guards against a logic regression slipping
  // a silent zero through.
  const seatedCount =
    result.strategy === "cushion_rank"
      ? result.cushion_assignments.length
      : result.groups.reduce((acc, g) => acc + g.members.length, 0);
  if (seatedCount === 0) {
    return NextResponse.json(
      {
        error: "no_seats_assigned",
        detail:
          "The algorithm produced zero assignments. Check group_size_min/max + cushion shape count.",
      },
      { status: 500 },
    );
  }

  const persistResult = await persistGroupingResult(eventId, result);
  if ("error" in persistResult) {
    return NextResponse.json({ error: persistResult.error }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.generated",
    entity: "events",
    entity_id: eventId,
    after: {
      strategy: result.strategy,
      n: result.metadata.n,
      k: result.metadata.k,
      groups_inserted: persistResult.groups_inserted,
      assignments_inserted: persistResult.assignments_inserted,
      latency_ms: Date.now() - startedAt,
    },
    metadata: {
      seating_mode: inputs.event.seating_mode,
    },
  });

  return NextResponse.json({
    ok: true,
    strategy: result.strategy,
    groups_inserted: persistResult.groups_inserted,
    assignments_inserted: persistResult.assignments_inserted,
    n: result.metadata.n,
    k: result.metadata.k,
  });
}
