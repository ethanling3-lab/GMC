import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { setMarketingStatus } from "@/lib/whatsapp/consent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/participants/[id]/marketing  { status }
//
// For when someone tells staff directly. "Not asked" isn't offered: once a
// person has given an answer, it can be changed but not forgotten.

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);
const Body = z.object({ status: z.enum(["subscribed", "unsubscribed"]) });

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Through the signed-in client, so region scoping decides who is visible.
  const scoped = await createSupabaseServerClient();
  const { data: visible } = await scoped.from("participants").select("id").eq("id", id).maybeSingle();
  if (!visible) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await setMarketingStatus(createSupabaseServiceClient(), {
      participantId: id,
      status: parsed.data.status,
      source: "admin",
      actorId: admin.id,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "update_failed";
    return NextResponse.json({ error: "update_failed", detail }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
