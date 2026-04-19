import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { EventCreateSchema } from "@/lib/event-update-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await requireAdmin();

  // Event creation is super_admin-only. Other roles edit/view.
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can create events" },
      { status: 403 },
    );
  }

  let body: ReturnType<typeof EventCreateSchema.parse>;
  try {
    body = EventCreateSchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  const { data, error } = await service
    .from("events")
    .insert({
      slug: body.slug,
      title_en: body.title_en ?? null,
      title_cn: body.title_cn ?? null,
      type: body.type,
      mode: body.mode,
      created_by: admin.id,
    })
    .select("id, slug")
    .single();

  if (error) {
    if (
      error.code === "23505" ||
      /duplicate key value.*slug/i.test(error.message)
    ) {
      return NextResponse.json(
        {
          error: `Slug "${body.slug}" is already in use. Pick a different one.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, slug: data.slug });
}
