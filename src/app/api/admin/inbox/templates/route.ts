import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { listTemplates, refreshTemplates, toSummary } from "@/lib/inbox/whatsapp-templates";
import { TemplateSyncError } from "@/lib/inbox/whatsapp-templates-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/inbox/templates[?refresh=1]
// Returns the WhatsApp template registry the composer picker renders. Data
// is fetched live from Meta and cached for 5 minutes; `?refresh=1` forces a
// re-fetch (admin escape hatch when a new template was just approved).

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  try {
    if (forceRefresh) {
      await refreshTemplates();
    }
    const { templates, fetchedAt, source } = await listTemplates();
    return NextResponse.json({
      templates: templates.map(toSummary),
      fetched_at: new Date(fetchedAt).toISOString(),
      source,
    });
  } catch (err) {
    if (err instanceof TemplateSyncError) {
      const status = err.code === "not_configured" ? 503 : 502;
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status },
      );
    }
    const msg = err instanceof Error ? err.message : "template fetch failed";
    return NextResponse.json({ error: "sync_failed", detail: msg }, { status: 500 });
  }
}
