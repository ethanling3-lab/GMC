import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { logParticipantChange } from "@/lib/participants/history";
import { REQUIRED_PROFILE_COLUMNS } from "@/lib/participants/required-profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/me/profile — a member fills in the details every registration
// needs (Phase 5): name, phone, occupation, industry, referrer + contact.
// Only these fields, only on their own record; each change is in the
// participant's edit history.

const text = (max: number) => z.string().trim().min(1).max(max);

const Body = z
  .object({
    name_cn: z.string().trim().max(120).optional().or(z.literal("")),
    name_en: z.string().trim().max(120).optional().or(z.literal("")),
    phone: z.string().trim().min(5).max(30).regex(/^[+0-9()\s-]+$/, "Invalid phone format"),
    occupation: text(120),
    industry: text(120),
    referrer_name: text(120),
    referrer_contact: text(120),
  })
  .refine((b) => Boolean(b.name_cn?.trim() || b.name_en?.trim()), { message: "Name is required", path: ["name_cn"] });

export async function PATCH(req: Request) {
  const participant = await requireParticipant();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", detail: "Please fill in every field. 请填写所有栏位。", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: before } = await service.from("participants").select(REQUIRED_PROFILE_COLUMNS).eq("id", participant.id).maybeSingle();

  const b = parsed.data;
  const after = {
    name_cn: b.name_cn?.trim() || null,
    name_en: b.name_en?.trim() || null,
    phone: b.phone,
    occupation: b.occupation,
    industry: b.industry,
    referrer_name: b.referrer_name,
    referrer_contact: b.referrer_contact,
  };
  const { error } = await service.from("participants").update(after).eq("id", participant.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }

  await logParticipantChange({
    actorId: null,
    participantId: participant.id,
    before: (before ?? {}) as Record<string, unknown>,
    after,
  });

  return NextResponse.json({ ok: true });
}
