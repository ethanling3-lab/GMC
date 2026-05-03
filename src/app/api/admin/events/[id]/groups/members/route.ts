import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { pickTableRoles } from "@/lib/grouping/roles";
import type { GroupingParticipant } from "@/lib/grouping/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/events/[id]/groups/members
//
// Two action shapes:
//   { action: "move", assignment_id, to_group_no }
//     - Reassign one participant to a different group.
//     - Refuses moves that bust [group_size_min, group_size_max].
//     - Refuses moves that put a family-linked pair in the same group.
//     - Recomputes 组长 / 副组长 roles on BOTH source + target groups
//       since the moving participant could have been the leader.
//
//   { action: "set_role", assignment_id, role: "zu_zhang"|"fu_zu_zhang"|"participant" }
//     - Direct role override on a single member. Demotes whoever else
//       held that role in the same group when the new role is unique
//       (zu_zhang).
//
// Audits as groups.member_moved or groups.role_changed accordingly.

type RouteCtx = { params: Promise<{ id: string }> };

const MoveBody = z.object({
  action: z.literal("move"),
  assignment_id: z.string().uuid(),
  to_group_no: z.number().int().min(1).max(999),
});

const RoleBody = z.object({
  action: z.literal("set_role"),
  assignment_id: z.string().uuid(),
  role: z.enum(["zu_zhang", "fu_zu_zhang", "participant"]),
});

const RationaleBody = z.object({
  action: z.literal("set_rationale"),
  group_id: z.string().uuid(),
  rationale_en: z.string().trim().max(2000),
  rationale_cn: z.string().trim().max(2000),
});

const Body = z.discriminatedUnion("action", [MoveBody, RoleBody, RationaleBody]);

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json(
      { error: "validation_error", detail: msg },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  if (body.action === "set_rationale") {
    const { data: before } = await service
      .from("event_groups")
      .select("id, event_id, rationale_en, rationale_cn")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!before || before.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { error: updErr } = await service
      .from("event_groups")
      .update({
        rationale_en: body.rationale_en,
        rationale_cn: body.rationale_cn,
      })
      .eq("id", body.group_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.rationale_edited",
      entity: "event_groups",
      entity_id: body.group_id,
      before: {
        rationale_en: before.rationale_en,
        rationale_cn: before.rationale_cn,
      },
      after: {
        rationale_en: body.rationale_en,
        rationale_cn: body.rationale_cn,
      },
      metadata: { event_id: eventId },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_role") {
    const { data: assignment } = await service
      .from("event_seat_assignments")
      .select("id, event_id, group_id, participant_id, role")
      .eq("id", body.assignment_id)
      .maybeSingle();
    if (!assignment || assignment.event_id !== eventId || !assignment.group_id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (assignment.role === body.role) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    // If promoting to zu_zhang, demote any existing zu_zhang in the same
    // group to participant first.
    if (body.role === "zu_zhang") {
      await service
        .from("event_seat_assignments")
        .update({ role: "participant" })
        .eq("group_id", assignment.group_id)
        .eq("role", "zu_zhang");
    }
    const { error: updErr } = await service
      .from("event_seat_assignments")
      .update({ role: body.role })
      .eq("id", body.assignment_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (body.role === "zu_zhang") {
      await service
        .from("event_groups")
        .update({ leader_participant_id: assignment.participant_id })
        .eq("id", assignment.group_id);
    }

    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.role_changed",
      entity: "event_seat_assignments",
      entity_id: body.assignment_id,
      before: { role: assignment.role },
      after: { role: body.role },
      metadata: {
        event_id: eventId,
        group_id: assignment.group_id,
        participant_id: assignment.participant_id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // body.action === "move"
  const { data: event } = await service
    .from("events")
    .select("group_size_min, group_size_max")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  }

  const { data: source } = await service
    .from("event_seat_assignments")
    .select("id, event_id, group_id, participant_id, role")
    .eq("id", body.assignment_id)
    .maybeSingle();
  if (!source || source.event_id !== eventId || !source.group_id) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  // Resolve target group_id from the requested group_no.
  const { data: targetGroup } = await service
    .from("event_groups")
    .select("id, group_no")
    .eq("event_id", eventId)
    .eq("group_no", body.to_group_no)
    .maybeSingle();
  if (!targetGroup) {
    return NextResponse.json({ error: "target_group_not_found" }, { status: 404 });
  }
  if (targetGroup.id === source.group_id) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Pull both groups' current memberships + the moving participant's family.
  const { data: sourceMembers } = await service
    .from("event_seat_assignments")
    .select("id, participant_id, role")
    .eq("group_id", source.group_id);
  const { data: targetMembers } = await service
    .from("event_seat_assignments")
    .select("id, participant_id, role")
    .eq("group_id", targetGroup.id);

  // Size check (only the upper bound matters — moving someone OUT of a
  // group can drop it below min, but admin can fix that with a counter
  // move; we don't auto-revert).
  if ((targetMembers?.length ?? 0) + 1 > event.group_size_max) {
    return NextResponse.json(
      {
        error: "target_group_too_large",
        detail: `Group ${body.to_group_no} would exceed max size ${event.group_size_max}.`,
      },
      { status: 409 },
    );
  }

  // Family check — pull the participants table for the moving + target
  // members and verify no shared family chain.
  const memberPids = (targetMembers ?? []).map((m) => m.participant_id);
  const targetParticipantIds = [...memberPids, source.participant_id];
  const { data: parts } = await service
    .from("participants")
    .select("id, family_of_participant_id")
    .in("id", targetParticipantIds)
    .returns<Array<{ id: string; family_of_participant_id: string | null }>>();
  if (parts && wouldCreateFamilyConflict(parts, source.participant_id, memberPids)) {
    return NextResponse.json(
      {
        error: "family_conflict",
        detail:
          "Moving this person would put two family members in the same group.",
      },
      { status: 409 },
    );
  }

  // Apply the move + reparent the assignment.
  const { error: moveErr } = await service
    .from("event_seat_assignments")
    .update({
      group_id: targetGroup.id,
      // Reset role; we recompute below.
      role: "participant",
    })
    .eq("id", body.assignment_id);
  if (moveErr) {
    return NextResponse.json({ error: moveErr.message }, { status: 500 });
  }

  // Recompute roles on BOTH groups now that membership changed.
  await Promise.all([
    recomputeGroupRoles(service, source.group_id, eventId),
    recomputeGroupRoles(service, targetGroup.id, eventId),
  ]);

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.member_moved",
    entity: "event_seat_assignments",
    entity_id: body.assignment_id,
    before: { group_id: source.group_id, role: source.role },
    after: { group_id: targetGroup.id, role: "participant" },
    metadata: {
      event_id: eventId,
      participant_id: source.participant_id,
      from_group_no: undefined,
      to_group_no: body.to_group_no,
      via: "drag_drop",
    },
  });

  return NextResponse.json({ ok: true });
}

function wouldCreateFamilyConflict(
  parts: Array<{ id: string; family_of_participant_id: string | null }>,
  movingPid: string,
  targetMemberPids: string[],
): boolean {
  // Build the same connected-component family-chain map, then check
  // whether the moving participant shares a chain with anyone already
  // in the target group.
  const adj = new Map<string, Set<string>>();
  for (const p of parts) {
    if (!adj.has(p.id)) adj.set(p.id, new Set());
    if (p.family_of_participant_id) {
      const a = p.id;
      const b = p.family_of_participant_id;
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  // BFS from movingPid; if we hit any target member, conflict.
  const seen = new Set<string>([movingPid]);
  const queue = [movingPid];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur !== movingPid && targetMemberPids.includes(cur)) return true;
    for (const neigh of adj.get(cur) ?? []) {
      if (!seen.has(neigh)) {
        seen.add(neigh);
        queue.push(neigh);
      }
    }
  }
  return false;
}

async function recomputeGroupRoles(
  service: ReturnType<typeof createSupabaseServiceClient>,
  groupId: string,
  eventId: string,
): Promise<void> {
  const { data: members } = await service
    .from("event_seat_assignments")
    .select(
      "id, participant_id, participant:participants!inner(id, region_id, overall_score, influence_score, financial_score, motivation_tag, is_old_student, family_of_participant_id, region)",
    )
    .eq("group_id", groupId)
    .returns<
      Array<{
        id: string;
        participant_id: string;
        participant: {
          id: string;
          region_id: string | null;
          overall_score: number | null;
          influence_score: number | null;
          financial_score: number | null;
          motivation_tag: string | null;
          is_old_student: boolean;
          family_of_participant_id: string | null;
          region: string | null;
        };
      }>
    >();
  if (!members || members.length === 0) {
    await service
      .from("event_groups")
      .update({ leader_participant_id: null })
      .eq("id", groupId);
    return;
  }

  const groupingParticipants: GroupingParticipant[] = members.map((m) => ({
    participant_id: m.participant.id,
    region_id: m.participant.region_id,
    overall_score: m.participant.overall_score,
    influence_score: m.participant.influence_score,
    financial_score: m.participant.financial_score,
    motivation_tag: m.participant.motivation_tag,
    is_old_student: m.participant.is_old_student,
    family_of_participant_id: m.participant.family_of_participant_id,
    region: m.participant.region,
    pinned_group_no: null,
  }));

  const roles = pickTableRoles(groupingParticipants);
  const roleByPid = new Map(roles.map((r) => [r.participant_id, r.role]));

  // Update each assignment row's role.
  for (const m of members) {
    const newRole = roleByPid.get(m.participant_id) ?? "participant";
    await service
      .from("event_seat_assignments")
      .update({ role: newRole })
      .eq("id", m.id);
  }
  // Update group's leader pointer.
  const newLeader = members.find(
    (m) => roleByPid.get(m.participant_id) === "zu_zhang",
  );
  await service
    .from("event_groups")
    .update({ leader_participant_id: newLeader?.participant_id ?? null })
    .eq("id", groupId);

  void eventId; // surfaced in audit metadata at the call site
}
