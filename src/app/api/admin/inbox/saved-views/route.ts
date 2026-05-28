import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import {
  createSavedView,
  listSavedViewsForAdmin,
  type SavedViewWriteInput,
} from "@/lib/inbox/saved-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FiltersSchema = z.object({
  scope: z.enum(["mine", "unassigned", "all"]),
  channel: z.enum(["whatsapp", "line", "email"]).nullable(),
  status: z.enum(["open", "pending", "snoozed", "closed"]).nullable(),
  lifecycle: z
    .enum(["lead", "new", "info_verified", "cs_enriched", "active", "inactive"])
    .nullable(),
  tag: z.string().nullable(),
  q: z.string(),
});

const Body = z.object({
  name: z.string().min(1).max(60),
  filters: FiltersSchema,
});

// GET /api/admin/inbox/saved-views — list the caller's own saved views.
// Per-admin scoping happens in the lib, not the route.
export async function GET() {
  const admin = await requireAdmin();
  const views = await listSavedViewsForAdmin(admin);
  return NextResponse.json({ views });
}

// POST /api/admin/inbox/saved-views — create a saved view for the caller.
// Body: { name: string, filters: SavedViewFilters }
//
// Role-gate is broad here (any admin can save their own presets) — saved
// views are personal triage shortcuts, not org-shared knowledge like
// tags + snippets.
export async function POST(req: Request) {
  const admin = await requireAdmin();

  let body: SavedViewWriteInput;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const { view, error } = await createSavedView(body, admin);
  if (error) {
    const status = error.field === "name_conflict" ? 409 : 400;
    return NextResponse.json({ error: error.field, detail: error.message }, { status });
  }
  return NextResponse.json({ view }, { status: 201 });
}
