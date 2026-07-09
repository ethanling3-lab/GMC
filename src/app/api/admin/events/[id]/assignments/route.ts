import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/events/[id]/assignments — create an assignment.
// GET  /api/admin/events/[id]/assignments — list assignments + submission counts.

const createSchema = z.object({
  title_en: z.string().max(200).optional(),
  title_cn: z.string().max(200).optional(),
  description_en: z.string().max(4000).optional(),
  description_cn: z.string().max(4000).optional(),
  kind: z.enum(["homework", "report"]).default("homework"),
  submission_type: z.enum(["file", "text", "both"]).default("both"),
  due_at: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }
  if (!parsed.data.title_en && !parsed.data.title_cn) {
    return NextResponse.json({ error: "title_required", detail: "title_en or title_cn required" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("course_assignments")
    .insert({
      event_id: eventId,
      title_en: parsed.data.title_en ?? null,
      title_cn: parsed.data.title_cn ?? null,
      description_en: parsed.data.description_en ?? null,
      description_cn: parsed.data.description_cn ?? null,
      kind: parsed.data.kind,
      submission_type: parsed.data.submission_type,
      due_at: parsed.data.due_at ?? null,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "insert_failed", detail: error?.message ?? "unknown" }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "assignment.created",
    entity: "course_assignments",
    entity_id: data.id,
    metadata: { event_id: eventId, kind: parsed.data.kind, submission_type: parsed.data.submission_type },
  });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  void admin;
  const { id: eventId } = await params;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("course_assignments")
    .select("id, title_en, title_cn, kind, submission_type, due_at, active, created_at")
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((a) => (a as { id: string }).id);
  const submittedCount = new Map<string, number>();
  const draftCount = new Map<string, number>();
  if (ids.length > 0) {
    const { data: subs } = await service
      .from("course_submissions")
      .select("assignment_id, status")
      .in("assignment_id", ids);
    for (const s of (subs ?? []) as Array<{ assignment_id: string; status: string }>) {
      const map = s.status === "submitted" ? submittedCount : draftCount;
      map.set(s.assignment_id, (map.get(s.assignment_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    assignments: (data ?? []).map((a) => {
      const id = (a as { id: string }).id;
      return {
        ...(a as Record<string, unknown>),
        submitted_count: submittedCount.get(id) ?? 0,
        draft_count: draftCount.get(id) ?? 0,
      };
    }),
  });
}
