import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { loadTransferDetail } from "@/lib/transfer/transfer-query";
import {
  serializeArrivals,
  serializeDepartures,
} from "@/lib/transfer/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/transfer-lists/event/[eventId]/export.xlsx
//
// Builds a one-workbook XLSX containing both arrival and departure tabs
// for the given event. Uses the same serialize helpers that drive the
// Google Sheet export so the on-disk file matches what logistics sees in
// the Sheet.
//
// Read role gate matches the transfer_lists RLS read policy: super,
// regional_lead, instructor.

type RouteCtx = { params: Promise<{ eventId: string }> };

function rolesAllowedToRead(role: string): boolean {
  return (
    role === "super_admin" ||
    role === "regional_lead" ||
    role === "instructor"
  );
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!rolesAllowedToRead(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { eventId } = await params;
  const service = createSupabaseServiceClient();
  const detail = await loadTransferDetail(service, eventId);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const wb = XLSX.utils.book_new();
  const arrivalSheet = XLSX.utils.aoa_to_sheet(serializeArrivals(detail.arrival));
  const departureSheet = XLSX.utils.aoa_to_sheet(serializeDepartures(detail.departure));
  XLSX.utils.book_append_sheet(wb, arrivalSheet, "接机安排 · Arrivals");
  XLSX.utils.book_append_sheet(wb, departureSheet, "送机安排 · Departures");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `${detail.event.slug}-transfers.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
