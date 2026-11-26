import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { giveChildOwnContact } from "@/lib/participants/children";
import { inviteParticipantToAccountIfNeeded } from "@/lib/participant-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/participants/[id]/own-login — Super Admin gives a child
// (migration 084) their own email + login. [id] is the CHILD. They stay linked
// to the parent; messages about them now go to their own contact.
const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().trim().max(40).optional().nullable(),
});

export async function POST(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const res = await giveChildOwnContact(id, { email: parsed.data.email, phone: parsed.data.phone ?? null });
  if (!res.ok) {
    return NextResponse.json({ error: res.reason, detail: res.detail }, { status: res.reason === "email_taken" ? 409 : 400 });
  }

  const invite = await inviteParticipantToAccountIfNeeded(id, "manual");
  await writeAuditLog({
    actor_id: admin.id,
    action: "participant.child_own_login",
    entity: "participants",
    entity_id: id,
    after: { email: parsed.data.email, phone: parsed.data.phone ?? null, invite: invite.status },
  });

  return NextResponse.json({ ok: true, invite: invite.status });
}
