import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { childrenOf, findOrCreateChild } from "@/lib/participants/children";
import { ChildBody } from "@/lib/participants/child-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  /api/me/children — the logged-in parent's children.
// POST /api/me/children — add a child (same name + birth date = same child).


export async function GET() {
  const me = await requireParticipant();
  return NextResponse.json({ children: await childrenOf(me.id) });
}

export async function POST(req: Request) {
  const me = await requireParticipant();
  const parsed = ChildBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  if (parsed.data.birth_date > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "invalid", detail: "Birth date can't be in the future." }, { status: 400 });
  }
  const { child, created } = await findOrCreateChild(me.id, parsed.data);
  return NextResponse.json({ ok: true, child, created }, { status: created ? 201 : 200 });
}
