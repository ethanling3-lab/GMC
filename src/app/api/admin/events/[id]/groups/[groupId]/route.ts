import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DELETE /api/admin/events/[id]/groups/[groupId]
//
// Pass 2 — admin removes a manually-created (or now-empty) group. Refuses
// when any event_seat_assignments still reference the group; admin must
// move members out first via drag-drop.
//
// Whether the group is locked or not doesn't matter — delete is an
// explicit destructive action so the lock is purely about Regenerate.

type RouteCtx = { params: Promise<{ id: string; groupId: string }> };

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId, groupId } = await params;
  const service = createSupabaseServiceClient();

  const { data: group } = await service
    .from("event_groups")
    .select("id, event_id, group_no, group_class, locked, name_en, name_cn")
    .eq("id", groupId)
    .maybeSingle();
  if (!group || group.event_id !== eventId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Refuse delete when members still seated. Admin moves them first.
  const { count: memberCount } = await service
    .from("event_seat_assignments")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);
  if ((memberCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "group_not_empty",
        detail: `Group ${group.group_no} still has ${memberCount} member(s). Move them out first.`,
      },
      { status: 409 },
    );
  }

  const { error: delErr } = await service
    .from("event_groups")
    .delete()
    .eq("id", groupId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "groups.deleted",
    entity: "event_groups",
    entity_id: groupId,
    before: {
      group_no: group.group_no,
      group_class: group.group_class,
      locked: group.locked,
      name_en: group.name_en,
      name_cn: group.name_cn,
    },
    metadata: { event_id: eventId },
  });

  return NextResponse.json({ ok: true });
}
