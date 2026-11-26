import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { isChildOf } from "@/lib/participants/children";
import { ChildBody } from "@/lib/participants/child-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ childId: string }> };

// PATCH /api/me/children/[childId] — a parent corrects their child's name,
// birth date or gender.
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await requireParticipant();
  const { childId } = await params;
  const service = createSupabaseServiceClient();
  if (!(await isChildOf(me.id, childId, service))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = ChildBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", detail: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  const { error } = await service
    .from("participants")
    .update({
      name_cn: parsed.data.name_cn,
      name_en: parsed.data.name_en || null,
      birth_date: parsed.data.birth_date,
      gender: parsed.data.gender ?? null,
    })
    .eq("id", childId);
  if (error) return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
