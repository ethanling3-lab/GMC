import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { googleConfigured, GoogleNotConfiguredError } from "@/lib/google/auth";
import { createSpreadsheet, shareWithUser } from "@/lib/google/drive";
import { writeTab } from "@/lib/google/sheets";
import { loadTransferDetail } from "@/lib/transfer/transfer-query";
import { serializeArrivals, serializeDepartures } from "@/lib/transfer/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/transfer-lists/[id]/export
//
// Pushes BOTH directions of the transfer list for the parent event into the
// per-event Google Sheet (one sheet per event, two tabs). The Sheet is
// auto-provisioned on first export — file id stored on events.transfer_sheet_id
// so subsequent exports rewrite the same Sheet.
//
// Sheet name format: "<event_slug> — Transfers"
// Tabs: "接机安排 · Arrivals", "送机安排 · Departures"
//
// Optional env vars:
//   GMC_GOOGLE_SERVICE_ACCOUNT_JSON  (required) base64 or raw JSON key
//   GMC_PARENT_DRIVE_FOLDER_ID       (recommended) parent Drive folder
//   GMC_TRANSFER_SHARE_EMAILS        comma-separated list of emails to auto-share new sheets with as writers

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (!googleConfigured()) {
    return NextResponse.json(
      {
        error: "not_configured",
        detail:
          "Set GMC_GOOGLE_SERVICE_ACCOUNT_JSON in Netlify env to enable Sheet export.",
      },
      { status: 503 },
    );
  }

  const service = createSupabaseServiceClient();

  const { data: list, error: listErr } = await service
    .from("transfer_lists")
    .select("id, event_id, direction, status")
    .eq("id", id)
    .maybeSingle();
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  if (!list) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const detail = await loadTransferDetail(service, list.event_id);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ev = detail.event;

  let sheetId = ev.transfer_sheet_id;
  let sheetUrl = ev.transfer_sheet_url;

  try {
    if (!sheetId) {
      const folderId = process.env.GMC_PARENT_DRIVE_FOLDER_ID || null;
      const created = await createSpreadsheet(`${ev.slug} — Transfers`, folderId);
      sheetId = created.id;
      sheetUrl = created.url;
      const { error: setErr } = await service
        .from("events")
        .update({ transfer_sheet_id: sheetId, transfer_sheet_url: sheetUrl })
        .eq("id", ev.id);
      if (setErr) {
        return NextResponse.json({ error: setErr.message }, { status: 500 });
      }

      // Optional auto-share — best-effort, errors don't fail the export.
      const shareList = (process.env.GMC_TRANSFER_SHARE_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const email of shareList) {
        try {
          await shareWithUser(sheetId, email, "writer");
        } catch (err) {
          console.warn(
            "[transfer.export] share failed",
            email,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (sheetId) {
      await writeTab(sheetId, "接机安排 · Arrivals", serializeArrivals(detail.arrival));
      await writeTab(sheetId, "送机安排 · Departures", serializeDepartures(detail.departure));
    }

    await service
      .from("events")
      .update({ transfer_synced_at: new Date().toISOString() })
      .eq("id", ev.id);

    await writeAuditLog({
      actor_id: admin.id,
      action: "transfer_list.exported",
      entity: "transfer_lists",
      entity_id: id,
      metadata: {
        event_id: ev.id,
        sheet_id: sheetId,
        sheet_url: sheetUrl,
      },
    });

    return NextResponse.json({
      ok: true,
      sheet_id: sheetId,
      sheet_url: sheetUrl,
    });
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      return NextResponse.json(
        { error: "not_configured", detail: err.message },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: "export_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
