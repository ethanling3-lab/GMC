import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { deactivateProgramme, updateProgramme } from "@/lib/programmes/programmes";
import type { ProgrammeWriteInput } from "@/lib/programmes/programmes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead"]);

// PATCH /api/admin/programmes/:id — partial update (slug is immutable).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super / regional leads can edit programmes." },
      { status: 403 },
    );
  }

  const { id } = await params;
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
  const patch: Partial<Omit<ProgrammeWriteInput, "slug">> = {};
  if (raw.name_en !== undefined) patch.name_en = String(raw.name_en);
  if (raw.name_cn !== undefined) patch.name_cn = String(raw.name_cn);
  if (raw.abbrev !== undefined) patch.abbrev = String(raw.abbrev);
  if (raw.validity_months !== undefined) {
    patch.validity_months =
      raw.validity_months === null || raw.validity_months === ""
        ? null
        : Number(raw.validity_months);
  }
  if (raw.price_sgd !== undefined) patch.price_sgd = Number(raw.price_sgd);
  if (raw.on_site_sgd !== undefined) {
    patch.on_site_sgd =
      raw.on_site_sgd === null || raw.on_site_sgd === "" ? null : Number(raw.on_site_sgd);
  }
  if (raw.active !== undefined) patch.active = Boolean(raw.active);
  if (raw.sort_order !== undefined) patch.sort_order = Number(raw.sort_order);

  const { programme, error, notFound } = await updateProgramme(id, patch, admin);
  if (notFound) {
    return NextResponse.json({ error: "not_found", detail: "Programme not found." }, { status: 404 });
  }
  if (error) {
    const status = error.field === "slug_conflict" ? 409 : 400;
    return NextResponse.json({ error: error.field, detail: error.message }, { status });
  }
  return NextResponse.json({ programme });
}

// DELETE /api/admin/programmes/:id — deactivate (programmes are never hard
// deleted; they're referenced by participants + price tiers).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super / regional leads can deactivate programmes." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const { ok, notFound } = await deactivateProgramme(id, admin);
  if (notFound) {
    return NextResponse.json({ error: "not_found", detail: "Programme not found." }, { status: 404 });
  }
  if (!ok) {
    return NextResponse.json({ error: "deactivate_failed", detail: "Failed to deactivate." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
