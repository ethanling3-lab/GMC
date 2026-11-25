import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { issueSeats } from "@/lib/seats/seats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/participants/[id]/seats — Super Admin issues 名额 to a
// member by hand (migration 082). Body: { course_id, quantity, note }.
const Body = z
  .object({
    course_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const r = await issueSeats(id, { ...parsed.data, note: parsed.data.note ?? null }, admin);
  if (r.error) return NextResponse.json({ error: "invalid", detail: r.error }, { status: r.status ?? 400 });
  return NextResponse.json({ ok: true, ids: r.ids });
}
