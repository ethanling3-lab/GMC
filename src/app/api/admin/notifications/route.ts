import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  /api/admin/notifications        — the caller's undismissed alerts
// POST /api/admin/notifications        — { ids: [...] } | { all: true } → mark read
//
// Uses the RLS-scoped server client, not the service client, so the
// admin_id = auth.uid() policy from migration 054 is what enforces ownership.
// There is no route-level admin_id parameter anywhere by design: an endpoint
// that reports what you have not read must not accept somebody else's id.

const MAX_ROWS = 30;

export async function GET() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("admin_notifications")
    .select("id, kind, conversation_id, message_id, payload, created_at, read_at")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  return NextResponse.json({
    notifications: rows,
    unread: rows.filter((r) => r.read_at === null).length,
    admin_id: admin.id,
  });
}

const MarkBody = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_ROWS) }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(req: Request) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  let body: z.infer<typeof MarkBody>;
  try {
    body = MarkBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: "validation_error", detail: msg }, { status: 400 });
  }

  const now = new Date().toISOString();
  let query = supabase.from("admin_notifications").update({ read_at: now }).is("read_at", null);

  if ("ids" in body) query = query.in("id", body.ids);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
