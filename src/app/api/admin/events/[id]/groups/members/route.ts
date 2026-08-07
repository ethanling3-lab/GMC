import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/events/[id]/groups/members
//
// Two action shapes:
//   { action: "move", assignment_id, to_group_no }
//     - Reassign one participant to a different group.
//     - Refuses moves that bust [group_size_min, group_size_max].
//     - Refuses moves that put a family-linked pair in the same group.
//     - In M6.0 the moved member becomes 'participant'. If they were the
//       source's zu_zhang, the source's leader_participant_id is cleared
//       (admin must re-curate via the EnrollmentsTable / curate dialog).
//
//   { action: "set_role", assignment_id, role: "zu_zhang"|"fu_zu_zhang"|"participant" }
//     - Direct role override on a single member. Demotes whoever else
//       held that role in the same group when the new role is unique
//       (zu_zhang).
//
//   { action: "assign_leader", group_id, participant_id, role }
//     - Seat a curated 组长 straight into a group's 主/副 slot, moving
//       them in from anywhere (unassigned, another group, another
//       group's leadership) in a single call.
//
// Audits as groups.member_moved / groups.role_changed /
// groups.leader_assigned accordingly.

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

const ClassBody = z.object({
  action: z.literal("set_class"),
  group_id: z.string().uuid(),
  group_class: z.enum(["strategic", "key", "growth", "maintenance"]),
});

const NameBody = z.object({
  action: z.literal("set_name"),
  group_id: z.string().uuid(),
  // Empty string = clear (revert to auto-format). Trimmed.
  name_en: z.string().trim().max(120),
  name_cn: z.string().trim().max(120),
});

const LockedBody = z.object({
  action: z.literal("set_locked"),
  group_id: z.string().uuid(),
  locked: z.boolean(),
});

// "Reset to auto" — clears the implicit `edited` protection so the next
// Regenerate can reclaim this group. Does NOT touch `locked` (an admin
// who explicitly locked a group keeps that hard fence).
const EditedBody = z.object({
  action: z.literal("set_edited"),
  group_id: z.string().uuid(),
  edited: z.boolean(),
});

// Seat an enrolled participant into a group (from the Unassigned pool, or
// relocate someone who already has a row). Upserts on (event_id,
// participant_id) so it works whether or not they're currently seated.
const AddMemberBody = z.object({
  action: z.literal("add_member"),
  participant_id: z.string().uuid(),
  to_group_no: z.number().int().min(1).max(999),
});

// Remove a member from their group → back to the Unassigned pool.
const RemoveMemberBody = z.object({
  action: z.literal("remove_member"),
  assignment_id: z.string().uuid(),
});

// Seat a curated 组长 directly into a group's 主/副 leader slot in ONE
// call — the roster picker's write path. Collapses the old three-step
// dance (find in pool → add_member → set_role) and works whether the
// pick is currently unassigned, a plain member elsewhere, or leading
// another group. Whoever held the slot is demoted to participant.
const AssignLeaderBody = z.object({
  action: z.literal("assign_leader"),
  group_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  role: z.enum(["zu_zhang", "fu_zu_zhang"]),
});

const Body = z.discriminatedUnion("action", [
  MoveBody,
  RoleBody,
  RationaleBody,
  ClassBody,
  NameBody,
  LockedBody,
  EditedBody,
  AddMemberBody,
  RemoveMemberBody,
  AssignLeaderBody,
]);

// Stamp a group as hand-edited so persistGroupingResult protects it from
// Regenerate (migration 048). Fire-and-forget: a failure here must not
// fail the edit that already succeeded — the group is simply reclaimable
// on the next Regenerate, which is the pre-048 behaviour.
async function markGroupEdited(
  service: ReturnType<typeof createSupabaseServiceClient>,
  groupId: string,
): Promise<void> {
  await service
    .from("event_groups")
    .update({ edited: true })
    .eq("id", groupId)
    .eq("edited", false);
}

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
    await markGroupEdited(service, body.group_id);
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

  if (body.action === "set_name") {
    const nameEn = body.name_en.length > 0 ? body.name_en : null;
    const nameCn = body.name_cn.length > 0 ? body.name_cn : null;
    const { data: before } = await service
      .from("event_groups")
      .select("id, event_id, name_en, name_cn")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!before || before.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (before.name_en === nameEn && before.name_cn === nameCn) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    const { error: updErr } = await service
      .from("event_groups")
      .update({ name_en: nameEn, name_cn: nameCn })
      .eq("id", body.group_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await markGroupEdited(service, body.group_id);
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.name_changed",
      entity: "event_groups",
      entity_id: body.group_id,
      before: { name_en: before.name_en, name_cn: before.name_cn },
      after: { name_en: nameEn, name_cn: nameCn },
      metadata: { event_id: eventId },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_locked") {
    const { data: before } = await service
      .from("event_groups")
      .select("id, event_id, locked")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!before || before.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (before.locked === body.locked) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    const { error: updErr } = await service
      .from("event_groups")
      .update({ locked: body.locked })
      .eq("id", body.group_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.lock_changed",
      entity: "event_groups",
      entity_id: body.group_id,
      before: { locked: before.locked },
      after: { locked: body.locked },
      metadata: { event_id: eventId },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_edited") {
    const { data: before } = await service
      .from("event_groups")
      .select("id, event_id, edited")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!before || before.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (before.edited === body.edited) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    const { error: updErr } = await service
      .from("event_groups")
      .update({ edited: body.edited })
      .eq("id", body.group_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.reset_to_auto",
      entity: "event_groups",
      entity_id: body.group_id,
      before: { edited: before.edited },
      after: { edited: body.edited },
      metadata: { event_id: eventId },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_class") {
    const { data: before } = await service
      .from("event_groups")
      .select("id, event_id, group_class")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!before || before.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (before.group_class === body.group_class) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    const { error: updErr } = await service
      .from("event_groups")
      .update({ group_class: body.group_class })
      .eq("id", body.group_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    await markGroupEdited(service, body.group_id);
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.class_changed",
      entity: "event_groups",
      entity_id: body.group_id,
      before: { group_class: before.group_class },
      after: { group_class: body.group_class },
      metadata: { event_id: eventId, via: "card_dropdown" },
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
    await markGroupEdited(service, assignment.group_id);

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

  if (body.action === "remove_member") {
    const { data: assignment } = await service
      .from("event_seat_assignments")
      .select("id, event_id, group_id, participant_id, role")
      .eq("id", body.assignment_id)
      .maybeSingle();
    if (!assignment || assignment.event_id !== eventId || !assignment.group_id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { data: grp } = await service
      .from("event_groups")
      .select("id, group_no, locked")
      .eq("id", assignment.group_id)
      .maybeSingle();
    if (grp?.locked) {
      return NextResponse.json(
        {
          error: "group_locked",
          detail: `Group ${grp.group_no} is locked. Unlock it before removing members.`,
        },
        { status: 409 },
      );
    }
    const { error: delErr } = await service
      .from("event_seat_assignments")
      .delete()
      .eq("id", body.assignment_id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (assignment.role === "zu_zhang") {
      await service
        .from("event_groups")
        .update({ leader_participant_id: null })
        .eq("id", assignment.group_id);
    }
    await markGroupEdited(service, assignment.group_id);
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.member_removed",
      entity: "event_seat_assignments",
      entity_id: body.assignment_id,
      before: { group_id: assignment.group_id, role: assignment.role },
      after: { group_id: null },
      metadata: { event_id: eventId, participant_id: assignment.participant_id },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "assign_leader") {
    const { data: target } = await service
      .from("event_groups")
      .select("id, event_id, group_no, locked, leader_participant_id")
      .eq("id", body.group_id)
      .maybeSingle();
    if (!target || target.event_id !== eventId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (target.locked) {
      return NextResponse.json(
        {
          error: "target_group_locked",
          detail: `Group ${target.group_no} is locked. Unlock it before changing its leaders.`,
        },
        { status: 409 },
      );
    }

    const { data: enrol } = await service
      .from("enrollments")
      .select("id")
      .eq("event_id", eventId)
      .eq("participant_id", body.participant_id)
      .in("status", ["approved", "paid"])
      .maybeSingle();
    if (!enrol) {
      return NextResponse.json(
        { error: "not_enrolled", detail: "Not an approved/paid enrolment." },
        { status: 409 },
      );
    }

    const { data: prior } = await service
      .from("event_seat_assignments")
      .select("id, group_id, role")
      .eq("event_id", eventId)
      .eq("participant_id", body.participant_id)
      .maybeSingle();

    // Pulling someone OUT of a locked group is the same hard fence the
    // move path enforces. Tier mismatch / group size / family stay soft —
    // the picker flags them, the admin decides.
    let priorGroupNo: number | null = null;
    if (prior?.group_id && prior.group_id !== target.id) {
      const { data: priorGroup } = await service
        .from("event_groups")
        .select("id, group_no, locked")
        .eq("id", prior.group_id)
        .maybeSingle();
      if (priorGroup?.locked) {
        return NextResponse.json(
          {
            error: "source_group_locked",
            detail: `Group ${priorGroup.group_no} is locked. Unlock it before moving that person out.`,
          },
          { status: 409 },
        );
      }
      priorGroupNo = priorGroup?.group_no ?? null;
    }

    if (prior && prior.group_id === target.id && prior.role === body.role) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // Demote whoever currently holds this slot in the target group.
    const { data: incumbents } = await service
      .from("event_seat_assignments")
      .select("id, participant_id")
      .eq("group_id", target.id)
      .eq("role", body.role)
      .neq("participant_id", body.participant_id);
    const demoted = incumbents?.[0]?.participant_id ?? null;
    if (incumbents && incumbents.length > 0) {
      const { error: demoteErr } = await service
        .from("event_seat_assignments")
        .update({ role: "participant" })
        .in(
          "id",
          incumbents.map((i) => i.id),
        );
      if (demoteErr) {
        return NextResponse.json({ error: demoteErr.message }, { status: 500 });
      }
    }

    // Upsert on (event_id, participant_id) so this one call handles all
    // three source states. Seats are cleared — the grouping changed, so
    // any floor-plan placement is stale until Auto-place re-runs.
    const { error: upErr } = await service
      .from("event_seat_assignments")
      .upsert(
        {
          event_id: eventId,
          participant_id: body.participant_id,
          group_id: target.id,
          role: body.role,
          shape_id: null,
          seat_no: null,
        },
        { onConflict: "event_id,participant_id" },
      );
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Leader-pointer bookkeeping. leader_participant_id tracks the 主组长
    // only, so it follows a zu_zhang pick and clears when the group's own
    // 组长 is demoted into the 副 slot.
    if (body.role === "zu_zhang") {
      await service
        .from("event_groups")
        .update({ leader_participant_id: body.participant_id })
        .eq("id", target.id);
    } else if (target.leader_participant_id === body.participant_id) {
      await service
        .from("event_groups")
        .update({ leader_participant_id: null })
        .eq("id", target.id);
    }
    if (prior?.group_id && prior.group_id !== target.id && prior.role === "zu_zhang") {
      await service
        .from("event_groups")
        .update({ leader_participant_id: null })
        .eq("id", prior.group_id);
    }

    await markGroupEdited(service, target.id);
    if (prior?.group_id && prior.group_id !== target.id) {
      await markGroupEdited(service, prior.group_id);
    }

    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.leader_assigned",
      entity: "event_groups",
      entity_id: target.id,
      before: {
        group_id: prior?.group_id ?? null,
        role: prior?.role ?? null,
      },
      after: { group_id: target.id, role: body.role },
      metadata: {
        event_id: eventId,
        participant_id: body.participant_id,
        to_group_no: target.group_no,
        from_group_no: priorGroupNo,
        demoted_participant_id: demoted,
        via: "leader_picker",
      },
    });

    return NextResponse.json({
      ok: true,
      demoted_participant_id: demoted,
      from_group_no: priorGroupNo,
    });
  }

  if (body.action === "add_member") {
    // Participant must be an approved/paid enrolment for this event.
    const { data: enrol } = await service
      .from("enrollments")
      .select("id, status")
      .eq("event_id", eventId)
      .eq("participant_id", body.participant_id)
      .in("status", ["approved", "paid"])
      .maybeSingle();
    if (!enrol) {
      return NextResponse.json(
        { error: "not_enrolled", detail: "Not an approved/paid enrolment." },
        { status: 409 },
      );
    }

    const { data: targetGroup } = await service
      .from("event_groups")
      .select("id, group_no, locked")
      .eq("event_id", eventId)
      .eq("group_no", body.to_group_no)
      .maybeSingle();
    if (!targetGroup) {
      return NextResponse.json({ error: "target_group_not_found" }, { status: 404 });
    }
    if (targetGroup.locked) {
      return NextResponse.json(
        {
          error: "target_group_locked",
          detail: `Group ${targetGroup.group_no} is locked. Unlock it before adding members.`,
        },
        { status: 409 },
      );
    }

    const { data: targetMembers } = await service
      .from("event_seat_assignments")
      .select("id, participant_id")
      .eq("group_id", targetGroup.id);

    // Already in this group? No-op.
    const existingHere = (targetMembers ?? []).some(
      (m) => m.participant_id === body.participant_id,
    );
    if (existingHere) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // Group size + family are SOFT for manual adds — no block on exceeding
    // max or on placing family together (the group card flags both). Only
    // lock stays a hard fence. The auto-generator still splits families.

    // If they already have an assignment elsewhere, clear that group's
    // leader pointer if they led it (upsert moves the single row).
    const { data: prior } = await service
      .from("event_seat_assignments")
      .select("id, group_id, role")
      .eq("event_id", eventId)
      .eq("participant_id", body.participant_id)
      .maybeSingle();
    if (prior?.group_id && prior.group_id !== targetGroup.id && prior.role === "zu_zhang") {
      await service
        .from("event_groups")
        .update({ leader_participant_id: null })
        .eq("id", prior.group_id);
    }

    const { error: upErr } = await service
      .from("event_seat_assignments")
      .upsert(
        {
          event_id: eventId,
          participant_id: body.participant_id,
          group_id: targetGroup.id,
          role: "participant",
          shape_id: null,
          seat_no: null,
        },
        { onConflict: "event_id,participant_id" },
      );
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await markGroupEdited(service, targetGroup.id);
    if (prior?.group_id && prior.group_id !== targetGroup.id) {
      await markGroupEdited(service, prior.group_id);
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "groups.member_added",
      entity: "event_seat_assignments",
      entity_id: prior?.id ?? targetGroup.id,
      after: { group_id: targetGroup.id, role: "participant" },
      metadata: {
        event_id: eventId,
        participant_id: body.participant_id,
        to_group_no: body.to_group_no,
        from_group_id: prior?.group_id ?? null,
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

  // Block drags from locked source groups. Lock is a hard fence — admin
  // must unlock first.
  const { data: sourceGroup } = await service
    .from("event_groups")
    .select("id, group_no, locked")
    .eq("id", source.group_id)
    .maybeSingle();
  if (sourceGroup?.locked) {
    return NextResponse.json(
      {
        error: "source_group_locked",
        detail: `Group ${sourceGroup.group_no} is locked. Unlock it before moving members out.`,
      },
      { status: 409 },
    );
  }

  // Resolve target group_id from the requested group_no.
  const { data: targetGroup } = await service
    .from("event_groups")
    .select("id, group_no, locked")
    .eq("event_id", eventId)
    .eq("group_no", body.to_group_no)
    .maybeSingle();
  if (!targetGroup) {
    return NextResponse.json({ error: "target_group_not_found" }, { status: 404 });
  }
  if (targetGroup.id === source.group_id) {
    return NextResponse.json({ ok: true, unchanged: true });
  }
  if (targetGroup.locked) {
    return NextResponse.json(
      {
        error: "target_group_locked",
        detail: `Group ${targetGroup.group_no} is locked. Unlock it before moving members in.`,
      },
      { status: 409 },
    );
  }

  // Group size + family are SOFT for manual moves: admins may deliberately
  // over-fill a group or place family together (the group card flags family
  // co-occurrence + an out-of-range pax chip). Only lock stays a hard fence
  // here. The auto-generator still splits families — this leniency is
  // manual-only. `event` above doubles as the existence check.

  // Apply the move + reparent the assignment with role reset.
  const { error: moveErr } = await service
    .from("event_seat_assignments")
    .update({
      group_id: targetGroup.id,
      role: "participant",
    })
    .eq("id", body.assignment_id);
  if (moveErr) {
    return NextResponse.json({ error: moveErr.message }, { status: 500 });
  }

  // If the moved member was the source group's 组长, clear the source's
  // leader pointer. Admin re-curates via the curate dialog or set_role.
  if (source.role === "zu_zhang") {
    await service
      .from("event_groups")
      .update({ leader_participant_id: null })
      .eq("id", source.group_id);
  }

  // Both groups changed shape — protect them from Regenerate.
  await markGroupEdited(service, source.group_id);
  await markGroupEdited(service, targetGroup.id);

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

