import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { softDeleteSavedView } from "@/lib/inbox/saved-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// DELETE /api/admin/inbox/saved-views/:id — soft-delete (sets deleted_at).
// Owner-only — softDeleteSavedView returns "forbidden" if the caller
// isn't the owner. Idempotent: deleting an already-deleted (or unknown)
// view returns 404, never partial state.
export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;
  const result = await softDeleteSavedView(id, admin);
  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
