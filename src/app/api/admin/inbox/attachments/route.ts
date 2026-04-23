import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Signs inbox-attachments paths for the thread viewer. The bucket is private
// so we can't hotlink; we mint short-lived signed URLs on demand.
//
// GET /api/admin/inbox/attachments?paths=<urlencoded,paths,...>
// Returns { [path]: signedUrl } with a per-request 10-min TTL.

const SIGN_TTL_SECONDS = 10 * 60;

const Query = z.object({
  paths: z.string().min(1).max(4000),
});

export async function GET(req: Request) {
  await requireAdmin();

  const url = new URL(req.url);
  const parsed = Query.safeParse({ paths: url.searchParams.get("paths") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const paths = parsed.data.paths
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("whatsapp/") || p.startsWith("line/") || p.startsWith("email/"))
    .slice(0, 40);

  if (paths.length === 0) {
    return NextResponse.json({ urls: {} });
  }

  // RLS on conversations gates visibility — do a read via the user-scoped
  // server client first so we only sign paths the admin can actually see.
  const supabase = await createSupabaseServerClient();

  // Path format: <channel>/<conversation_id>/<external_message_id>/<name>
  const conversationIds = Array.from(
    new Set(paths.map((p) => p.split("/")[1]).filter(Boolean)),
  );
  const { data: allowed, error } = await supabase
    .from("conversations")
    .select("id")
    .in("id", conversationIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const allowedSet = new Set((allowed ?? []).map((c) => c.id as string));
  const filteredPaths = paths.filter((p) => allowedSet.has(p.split("/")[1]));

  if (filteredPaths.length === 0) {
    return NextResponse.json({ urls: {} });
  }

  const service = createSupabaseServiceClient();
  const { data: signed, error: signErr } = await service.storage
    .from("inbox-attachments")
    .createSignedUrls(filteredPaths, SIGN_TTL_SECONDS);
  if (signErr) {
    return NextResponse.json({ error: signErr.message }, { status: 500 });
  }

  const urls: Record<string, string> = {};
  for (const row of signed ?? []) {
    if (row.path && row.signedUrl) urls[row.path] = row.signedUrl;
  }
  return NextResponse.json({ urls });
}
