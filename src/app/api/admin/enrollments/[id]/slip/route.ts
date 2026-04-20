import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_URL_TTL = 60 * 5; // 5 minutes — long enough for the admin to view, short enough to prevent leaks.

type RouteCtx = { params: Promise<{ id: string }> };

// 302-redirects an authenticated admin to a freshly-signed URL for the
// transfer-slip object stored in the private `transfer-slips` bucket.
// Used by the slip link in the enrolments console; replaces the need to
// surface raw object paths in the client bundle.
export async function GET(_req: Request, { params }: RouteCtx) {
  await requireAdmin();
  const { id: enrollmentId } = await params;

  const service = createSupabaseServiceClient();
  const { data: row, error } = await service
    .from("enrollments")
    .select("transfer_slip_url")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const path = (row as { transfer_slip_url: string | null } | null)?.transfer_slip_url;
  if (!path) {
    return NextResponse.json({ error: "no_slip" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await service.storage
    .from("transfer-slips")
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "sign_failed", detail: signErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
