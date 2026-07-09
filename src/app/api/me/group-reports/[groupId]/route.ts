import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { loadGroupReportForFill } from "@/lib/group-report-portal";
import { buildAnswersSchema, type FormSchema } from "@/lib/event-form-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ groupId: string }> };

// POST /api/me/group-reports/[groupId] — save (draft) or submit a group's
// report. Leader-gated (正组长/副组长). Upserts one row per (event, group).
// Draft: stored as-is. Submit: group answers + every member's answers are
// validated against the template's field schema (required fields enforced).

const bodySchema = z.object({
  action: z.enum(["draft", "submit"]),
  group_answers: z.record(z.string(), z.unknown()).default({}),
  member_answers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

function sectionSchema(fields: FormSchema["fields"]) {
  return buildAnswersSchema({ version: 1, identity: {} as FormSchema["identity"], fields });
}

export async function POST(req: Request, { params }: RouteCtx) {
  const participant = await requireParticipant();
  const { groupId } = await params;

  const fill = await loadGroupReportForFill(participant.id, groupId);
  if (!fill) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.message }, { status: 400 });
  }
  const { action, group_answers, member_answers } = parsed.data;

  // Keep only answers for real members of this group.
  const memberIds = new Set(fill.members.map((m) => m.participant_id));
  const cleanedMembers: Record<string, Record<string, unknown>> = {};
  for (const [pid, ans] of Object.entries(member_answers)) {
    if (memberIds.has(pid)) cleanedMembers[pid] = ans;
  }

  // Size guard.
  const payloadSize = JSON.stringify({ group_answers, member_answers: cleanedMembers }).length;
  if (payloadSize > 500_000) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  if (action === "submit") {
    const groupValidator = sectionSchema(fill.schema.group_section.fields);
    const groupCheck = groupValidator.safeParse(group_answers);
    if (!groupCheck.success) {
      return NextResponse.json(
        { error: "group_invalid", detail: "Please complete the summary section." },
        { status: 400 },
      );
    }
    const memberValidator = sectionSchema(fill.schema.member_section.fields);
    for (const m of fill.members) {
      const check = memberValidator.safeParse(cleanedMembers[m.participant_id] ?? {});
      if (!check.success) {
        const label = m.name_cn ?? m.name_en ?? m.region_id ?? m.participant_id;
        return NextResponse.json(
          { error: "member_invalid", detail: `Please complete the section for ${label}.`, participant_id: m.participant_id },
          { status: 400 },
        );
      }
    }
  }

  // template_id for the submission snapshot.
  const service = createSupabaseServiceClient();
  const { data: eventRow } = await service
    .from("events")
    .select("group_report_template_id")
    .eq("id", fill.group.event_id)
    .maybeSingle();
  const templateId = (eventRow as { group_report_template_id: string | null } | null)?.group_report_template_id ?? null;

  const now = new Date().toISOString();
  const { data: upserted, error } = await service
    .from("group_report_submissions")
    .upsert(
      {
        event_id: fill.group.event_id,
        group_id: groupId,
        template_id: templateId,
        status: action === "submit" ? "submitted" : "draft",
        group_answers,
        member_answers: cleanedMembers,
        submitted_by: participant.id,
        submitted_at: action === "submit" ? now : null,
      },
      { onConflict: "event_id,group_id" },
    )
    .select("id")
    .single();
  if (error || !upserted) {
    return NextResponse.json({ error: "save_failed", detail: error?.message ?? "unknown" }, { status: 500 });
  }

  await writeAuditLog({
    actor_id: null,
    action: action === "submit" ? "group_report.submitted" : "group_report.saved_draft",
    entity: "group_report_submissions",
    entity_id: upserted.id as string,
    metadata: { group_id: groupId, event_id: fill.group.event_id, participant_id: participant.id },
  });

  return NextResponse.json({ ok: true, status: action === "submit" ? "submitted" : "draft" });
}
