import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { ExtractedRow } from "@/lib/participant-import-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StatusRow = {
  id: string;
  admin_id: string;
  status: "pending" | "running" | "done" | "error";
  source_label: string | null;
  rows: ExtractedRow[] | null;
  summary: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const admin = await requireAdmin();
  const { jobId } = await params;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select(
      "id, admin_id, status, source_label, rows, summary, usage, error, created_at, started_at, finished_at",
    )
    .eq("id", jobId)
    .maybeSingle<StatusRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (data.admin_id !== admin.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    jobId: data.id,
    status: data.status,
    source: data.source_label ?? "",
    rows: data.rows ?? [],
    summary: data.summary ?? "",
    usage: data.usage ?? undefined,
    error: data.error ?? undefined,
    started_at: data.started_at,
    finished_at: data.finished_at,
  });
}
