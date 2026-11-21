import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { searchEligibleForCheckIn } from "@/lib/check-in/check-in-query";
import { todayInEventTz } from "@/lib/check-in/day";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/events/[id]/check-in/search?q=<query>
//
// Manual-search typeahead for the scanner page. Returns paid + approved
// (unpaid → `paid: false`) enrolments matching region_id / name_cn / name_en /
// phone (ILIKE), with each row's check-in status for TODAY so the UI can show
// a "Check in" button or an "Already arrived" pill.

type RouteCtx = { params: Promise<{ id: string }> };

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
  "instructor",
]);

export async function GET(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  try {
    const rows = await searchEligibleForCheckIn(eventId, q, todayInEventTz());
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[check-in search]", msg);
    return NextResponse.json(
      { error: "server_error", detail: msg },
      { status: 500 },
    );
  }
}
