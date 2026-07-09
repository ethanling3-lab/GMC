import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ fileId: string }> };

const SIGNED_URL_TTL_SECONDS = 300;

// GET /api/admin/submission-files/[fileId]/url — mint a short-lived signed
// download URL for a submission attachment. Admin-gated; used by the
// submissions viewer so links never go stale on a long-open page.

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { fileId } = await params;

  const service = createSupabaseServiceClient();
  const { data: file } = await service
    .from("course_submission_files")
    .select("storage_path, filename")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const f = file as { storage_path: string; filename: string };

  const { data: signed, error } = await service.storage
    .from("course-submissions")
    .createSignedUrl(f.storage_path, SIGNED_URL_TTL_SECONDS, { download: f.filename });
  if (error || !signed) {
    return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
