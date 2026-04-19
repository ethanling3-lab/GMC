import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  let body: { action?: "archive" | "unarchive" } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body — default to archive */
  }
  const action = body.action ?? "archive";

  // Scope-check through the regular client first — confirms the admin can see
  // this participant under their role's region/CS scope.
  const scoped = await createSupabaseServerClient();
  let scopeCheck = scoped
    .from("participants")
    .select("id, archived_at")
    .eq("id", id);
  scopeCheck = applyRoleScope(scopeCheck, admin.role, admin.id, admin.region);
  const { data: current, error: scopeErr } = await scopeCheck.maybeSingle();
  if (scopeErr || !current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Service client for the actual write (bypasses RLS).
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("participants")
    .update({
      archived_at: action === "archive" ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action });
}
