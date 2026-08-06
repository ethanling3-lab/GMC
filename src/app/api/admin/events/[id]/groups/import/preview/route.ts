import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { parseGroupingWorkbook } from "@/lib/grouping/xlsx-import";
import { loadImportContext, computePreview } from "@/lib/grouping/import-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/events/[id]/groups/import/preview
//
// Multipart upload of an edited grouping spreadsheet (.xlsx or .csv). Parses,
// resolves participants, and returns a diff + warnings. WRITES NOTHING — the
// admin reviews, then the client posts the returned desired_state to
// .../import/apply to commit.

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: eventId } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "file_too_large", detail: "Max 5 MB." },
      { status: 413 },
    );
  }

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseGroupingWorkbook(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "parse_failed";
    return NextResponse.json(
      { error: "parse_failed", detail: msg },
      { status: 400 },
    );
  }

  // Required columns: a key (Participant ID or Region ID) + Group #.
  if (
    !parsed.headerMap.group_no ||
    (!parsed.headerMap.participant_id && !parsed.headerMap.region_id)
  ) {
    return NextResponse.json(
      {
        error: "missing_columns",
        detail:
          "The file needs a 'Group #' column and a 'Student ID' (or Participant ID) column. Re-export from the groups page to get the correct template.",
      },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const ctx = await loadImportContext(service, eventId);
  if ("error" in ctx) {
    const status = ctx.error === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: ctx.error }, { status });
  }
  if (ctx.event.seating_mode === "cushions") {
    return NextResponse.json(
      {
        error: "cushion_mode_unsupported",
        detail: "Spreadsheet import is only available for table-mode grouping.",
      },
      { status: 409 },
    );
  }

  const preview = computePreview(parsed.rows, ctx);
  return NextResponse.json({
    ok: true,
    filename: file.name,
    dropped_rows: parsed.droppedRows,
    ...preview,
  });
}
