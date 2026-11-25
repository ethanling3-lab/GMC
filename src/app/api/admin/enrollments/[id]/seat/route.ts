import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { releaseSeat, useSeat } from "@/lib/seats/seats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST   /api/admin/enrollments/[id]/seat { seat_id } — use a 名额 on this
//        registration: course fee waived, 会务费 only.
// DELETE /api/admin/enrollments/[id]/seat { reason } — take it off again;
//        the seat goes back to the recipient and the price is re-worked.
// Super Admin only. Both audited.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const parsed = z.object({ seat_id: z.string().uuid() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const r = await useSeat(id, parsed.data.seat_id, admin);
  if (r.error) return NextResponse.json({ error: "invalid", detail: r.error }, { status: r.status ?? 400 });
  return NextResponse.json({ ok: true, amount_due: r.amount_due });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "reason_required", detail: "Say why the 名额 is being removed." }, { status: 400 });
  }
  const r = await releaseSeat(id, parsed.data.reason, admin);
  if (!r.released) return NextResponse.json({ error: "invalid", detail: "No 名额 is used on this registration." }, { status: 404 });
  return NextResponse.json({ ok: true, amount_due: r.amount_due });
}
