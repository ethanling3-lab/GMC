import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { EventUpdateSchema } from "@/lib/event-update-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  // Event editing is super_admin-only for now. Regional leads view; later
  // milestones can grant targeted fields (e.g. capacity) to other roles.
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can edit events" },
      { status: 403 },
    );
  }

  let patch: ReturnType<typeof EventUpdateSchema.parse>;
  try {
    patch = EventUpdateSchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data, error } = await service
    .from("events")
    .update(patch)
    .eq("id", id)
    .select("id, updated_at")
    .maybeSingle();

  if (error) {
    if (
      error.code === "23505" ||
      /duplicate key value.*slug/i.test(error.message)
    ) {
      return NextResponse.json(
        {
          error: `Slug is already in use. Pick a different one.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    updated_at: data.updated_at,
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  if (admin.role !== "super_admin") {
    return NextResponse.json(
      {
        error:
          "Only super admins can permanently delete events. Archive it instead.",
      },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();
  const { error } = await service.from("events").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
