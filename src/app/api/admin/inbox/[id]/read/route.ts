import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/read — upserts the per-admin last_read_at cursor.
// Called by the thread view when the page mounts. No body needed.
//
// Later (Wave 2b) this cursor powers unread badges on the inbox list.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id: conversationId } = await params;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("conversation_reads")
    .upsert(
      {
        conversation_id: conversationId,
        admin_id: admin.id,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,admin_id" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
