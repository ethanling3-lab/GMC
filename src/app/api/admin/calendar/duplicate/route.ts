import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/calendar/duplicate { from_year } — copy every event
// of `from_year` (planned / open / closed; not drafts or
// archived) into `from_year + 1` as PLANNED with dates TBC, same month
// and day. Content, pricing and seating settings carry over; registrations
// don't. Events already copied (same title + same next-year start)
// are skipped, so running it twice is safe.

const Body = z.object({ from_year: z.number().int().min(2020).max(2100) }).strict();

const COPY_COLUMNS =
  "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, type, mode, venue, city, country, start_date, end_date, capacity, price, misc_fee, currency, price_tiers, payment_methods, requires_approval, seating_mode, group_size_min, group_size_max";

type Row = Record<string, unknown> & {
  id: string;
  slug: string;
  start_date: string;
  end_date: string | null;
  title_en: string | null;
  title_cn: string | null;
};

const copyKey = (r: { title_en: string | null; title_cn: string | null }, start: string) =>
  `${(r.title_cn ?? "").trim()}|${(r.title_en ?? "").trim()}|${start}`;

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const fromYear = parsed.data.from_year;
  const toYear = fromYear + 1;

  const service = createSupabaseServiceClient();
  const { data: src, error } = await service
    .from("events")
    .select(COPY_COLUMNS)
    .in("status", ["planned", "open", "closed"])
    .gte("start_date", `${fromYear}-01-01`)
    .lte("start_date", `${fromYear}-12-31`)
    .order("start_date", { ascending: true })
    .returns<Row[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: existing } = await service
    .from("events")
    .select("slug, title_en, title_cn, start_date")
    .gte("start_date", `${toYear}-01-01`)
    .lte("start_date", `${toYear}-12-31`)
    .returns<Array<{ slug: string; title_en: string | null; title_cn: string | null; start_date: string }>>();
  const already = new Set((existing ?? []).map((e) => copyKey(e, e.start_date)));
  const takenSlugs = new Set((existing ?? []).map((e) => e.slug));

  const inserts: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of src ?? []) {
    const start = shiftYear(r.start_date);
    if (already.has(copyKey(r, start))) {
      skipped += 1;
      continue;
    }
    const end = r.end_date ? shiftYear(r.end_date) : start;
    const base = r.slug.replace(/-?\d{4}(-\d{2}-\d{2})?(-\d+)?$/, "") || "session";
    let slug = `${base}-${start}`;
    for (let i = 2; takenSlugs.has(slug); i += 1) slug = `${base}-${start}-${i}`;
    takenSlugs.add(slug);
    const { id: _id, slug: _slug, ...rest } = r;
    void _id;
    void _slug;
    inserts.push({
      ...rest,
      slug,
      start_date: start,
      end_date: end,
      status: "planned",
      dates_tentative: true,
      created_by: admin.id,
    });
  }

  if (inserts.length > 0) {
    const { error: insErr } = await service.from("events").insert(inserts);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "events.duplicated_to_next_year",
    // audit_log.entity_id is a uuid; a bulk copy has no single event, so
    // the row is keyed to the acting admin.
    entity: "admins",
    entity_id: admin.id,
    after: { from_year: fromYear, to_year: toYear, created: inserts.length, skipped },
  });
  return NextResponse.json({ ok: true, created: inserts.length, skipped, to_year: toYear });
}

// Same month + day next year; 29 Feb → 28 Feb.
function shiftYear(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const ny = y + 1;
  const leap = (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${ny}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
