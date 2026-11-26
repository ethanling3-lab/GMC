import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";
import { writeAuditLogBatch } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const BulkBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("archive"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("unarchive"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("assign_cs"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    assigned_cs_id: z.string().uuid().nullable(),
  }),
]);

export async function POST(req: Request) {
  const admin = await requireAdmin();

  let body: z.infer<typeof BulkBody>;
  try {
    body = BulkBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (body.action === "delete" && admin.role !== "super_admin") {
    return NextResponse.json(
      {
        error:
          "Only super admins can permanently delete participants. Archive them instead.",
      },
      { status: 403 },
    );
  }

  // Assigning a CS is the Super Admin's call (checks the referral first).
  // Middleware already blocks other roles; this keeps the route safe alone.
  if (body.action === "assign_cs" && admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can assign a CS." }, { status: 403 });
  }

  // Scope check: regional_lead sees their region, customer_service sees their
  // assigned rows. Intersect the requested IDs with what this admin may touch.
  const scoped = await createSupabaseServerClient();
  let scopeCheck = scoped
    .from("participants")
    .select("id, archived_at, assigned_cs_id")
    .in("id", body.ids);
  scopeCheck = applyRoleScope(scopeCheck, admin.role, admin.id, admin.region);
  const { data: allowed, error: scopeErr } = await scopeCheck;
  if (scopeErr) {
    return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }
  const allowedIds = (allowed ?? []).map((r) => r.id);
  const skipped = body.ids.filter((id) => !allowedIds.includes(id));

  if (allowedIds.length === 0) {
    return NextResponse.json(
      {
        action: body.action,
        affected: 0,
        skipped: skipped.length,
        skippedIds: skipped,
      },
      { status: 200 },
    );
  }

  const service = createSupabaseServiceClient();

  switch (body.action) {
    case "delete": {
      const { error } = await service
        .from("participants")
        .delete()
        .in("id", allowedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      break;
    }
    case "archive":
    case "unarchive": {
      const archivedAt =
        body.action === "archive" ? new Date().toISOString() : null;
      const { error } = await service
        .from("participants")
        .update({ archived_at: archivedAt })
        .in("id", allowedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await writeAuditLogBatch(
        (allowed ?? [])
          .filter((r) => (r.archived_at ?? null) !== archivedAt)
          .map((r) => ({
            actor_id: admin.id,
            action: "participant.fields_changed" as const,
            entity: "participants",
            entity_id: r.id,
            before: { archived_at: r.archived_at ?? null },
            after: { archived_at: archivedAt },
          })),
      );
      break;
    }
    case "assign_cs": {
      const { error } = await service
        .from("participants")
        .update({ assigned_cs_id: body.assigned_cs_id })
        .in("id", allowedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await writeAuditLogBatch(
        (allowed ?? [])
          .filter((r) => (r.assigned_cs_id ?? null) !== body.assigned_cs_id)
          .map((r) => ({
            actor_id: admin.id,
            action: "participant.fields_changed" as const,
            entity: "participants",
            entity_id: r.id,
            before: { assigned_cs_id: r.assigned_cs_id ?? null },
            after: { assigned_cs_id: body.assigned_cs_id },
          })),
      );
      break;
    }
  }

  return NextResponse.json({
    action: body.action,
    affected: allowedIds.length,
    skipped: skipped.length,
    skippedIds: skipped,
    affectedIds: allowedIds,
  });
}
