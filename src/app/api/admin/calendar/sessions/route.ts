import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/calendar/sessions — quick-add a PLANNED session of a
// course (Super Admin). Creates a real event row with status 'planned';
// the admin fills in pricing/content later in the event editor and opens
// registration by switching it to 'open'.
const Body = z
  .object({
    course_id: z.string().uuid(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    country: z.string().trim().max(80).nullable().optional(),
    dates_tentative: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const b = parsed.data;
  if (b.end_date && b.end_date < b.start_date) {
    return NextResponse.json({ error: "invalid_dates", detail: "End date is before start date." }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: course } = await service
    .from("courses")
    .select("id, slug, name_en, name_cn")
    .eq("id", b.course_id)
    .maybeSingle<{ id: string; slug: string; name_en: string; name_cn: string }>();
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const slug = await freeSlug(service, `${course.slug}-${b.start_date}`);
  const { data: ev, error } = await service
    .from("events")
    .insert({
      slug,
      title_en: course.name_en,
      title_cn: course.name_cn,
      type: "course",
      status: "planned",
      course_id: course.id,
      start_date: b.start_date,
      end_date: b.end_date ?? b.start_date,
      city: b.city || null,
      country: b.country || null,
      dates_tentative: b.dates_tentative ?? false,
      created_by: admin.id,
    })
    .select("id, slug")
    .single<{ id: string; slug: string }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    actor_id: admin.id,
    action: "event.planned_created",
    entity: "events",
    entity_id: ev.id,
    after: { slug: ev.slug, course: course.slug, start_date: b.start_date, end_date: b.end_date ?? b.start_date },
  });
  return NextResponse.json({ ok: true, id: ev.id, slug: ev.slug }, { status: 201 });
}

// `base`, then `base-2`, `base-3`… — first slug not taken.
async function freeSlug(
  service: ReturnType<typeof createSupabaseServiceClient>,
  base: string,
): Promise<string> {
  const { data } = await service
    .from("events")
    .select("slug")
    .like("slug", `${base}%`)
    .returns<Array<{ slug: string }>>();
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
