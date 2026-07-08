import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createProgramme, listProgrammes } from "@/lib/programmes/programmes";
import type { ProgrammeWriteInput } from "@/lib/programmes/programmes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead"]);

// GET /api/admin/programmes — list programmes (?include_inactive=1 for all).
export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";
  const programmes = await listProgrammes({ includeInactive });
  return NextResponse.json({ programmes });
}

// POST /api/admin/programmes — create a programme.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super / regional leads can create programmes." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", detail: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;
  const input: ProgrammeWriteInput = {
    slug: String(raw.slug ?? ""),
    name_en: String(raw.name_en ?? ""),
    name_cn: String(raw.name_cn ?? ""),
    abbrev: String(raw.abbrev ?? ""),
    validity_months:
      raw.validity_months === null || raw.validity_months === undefined || raw.validity_months === ""
        ? null
        : Number(raw.validity_months),
    price_sgd: Number(raw.price_sgd ?? NaN),
    on_site_sgd:
      raw.on_site_sgd === null || raw.on_site_sgd === undefined || raw.on_site_sgd === ""
        ? null
        : Number(raw.on_site_sgd),
    active: raw.active === undefined ? true : Boolean(raw.active),
    sort_order: raw.sort_order === undefined ? 0 : Number(raw.sort_order),
  };

  const { programme, error } = await createProgramme(input, admin);
  if (error) {
    const status = error.field === "slug_conflict" ? 409 : 400;
    return NextResponse.json({ error: error.field, detail: error.message }, { status });
  }
  return NextResponse.json({ programme }, { status: 201 });
}
