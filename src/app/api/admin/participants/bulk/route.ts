import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const ParticipantStatusEnum = z.enum([
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
]);

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
    action: z.literal("set_status"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    status: ParticipantStatusEnum,
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

  // Scope check: regional_lead sees their region, customer_service sees their
  // assigned rows. Intersect the requested IDs with what this admin may touch.
  const scoped = await createSupabaseServerClient();
  let scopeCheck = scoped
    .from("participants")
    .select("id")
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
      break;
    }
    case "set_status": {
      const { error } = await service
        .from("participants")
        .update({ status: body.status })
        .in("id", allowedIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
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
