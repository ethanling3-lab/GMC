import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { updateSeat } from "@/lib/seats/seats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/seats/[seatId] — give a 名额 to a recipient, take it
// back, or cancel it. Super Admin only.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), recipient_id: z.string().uuid() }),
  z.object({ action: z.literal("unassign") }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3).max(300) }),
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ seatId: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { seatId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const r = await updateSeat(seatId, parsed.data, admin);
  if (r.error) return NextResponse.json({ error: "invalid", detail: r.error }, { status: r.status ?? 400 });
  return NextResponse.json({ ok: true });
}
