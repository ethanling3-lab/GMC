import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { listTemplates, toSummary } from "@/lib/inbox/whatsapp-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/inbox/templates
// Returns the WhatsApp template registry the composer picker renders.
// Static data today (no DB hit) — lives here so the client doesn't have to
// bundle the server-only registry module.

export async function GET() {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service"
  ) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can compose" },
      { status: 403 },
    );
  }

  const templates = listTemplates().map(toSummary);
  return NextResponse.json({ templates });
}
