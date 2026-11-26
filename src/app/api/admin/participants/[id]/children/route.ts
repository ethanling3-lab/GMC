import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { ChildBody } from "@/lib/participants/child-schema";
import { findOrCreateChild, linkGuardian, unlinkGuardian } from "@/lib/participants/children";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// /api/admin/participants/[id]/children — staff manage a parent's children
// (migration 084). [id] is the PARENT.
//   POST { mode: "new", name_cn, name_en?, birth_date, gender? } — add (dedupe by name + birth date)
//   POST { mode: "link", child_id }                              — an existing profile becomes their child
//   DELETE { child_id }                                          — unlink (the child's profile stays)
const PostBody = z.discriminatedUnion("mode", [
  ChildBody.extend({ mode: z.literal("new") }),
  z.object({ mode: z.literal("link"), child_id: z.string().uuid() }),
]);

export async function POST(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  try {
    if (parsed.data.mode === "link") {
      await linkGuardian(id, parsed.data.child_id, { adminId: admin.id });
      await writeAuditLog({ actor_id: admin.id, action: "participant.child_linked", entity: "participants", entity_id: id, after: { child_id: parsed.data.child_id } });
      return NextResponse.json({ ok: true });
    }
    const { mode: _mode, ...input } = parsed.data;
    void _mode;
    const { child, created } = await findOrCreateChild(id, input, { adminId: admin.id });
    if (created) {
      await writeAuditLog({ actor_id: admin.id, action: "participant.child_added", entity: "participants", entity_id: id, after: { child_id: child.id, name_cn: child.name_cn, birth_date: child.birth_date } });
    }
    return NextResponse.json({ ok: true, child, created });
  } catch (e) {
    return NextResponse.json({ error: "failed", detail: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const parsed = z.object({ child_id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await unlinkGuardian(id, parsed.data.child_id);
  await writeAuditLog({ actor_id: admin.id, action: "participant.child_unlinked", entity: "participants", entity_id: id, before: { child_id: parsed.data.child_id } });
  return NextResponse.json({ ok: true });
}
