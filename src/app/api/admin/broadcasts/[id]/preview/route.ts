import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import {
  interpolateWithDiagnostics,
  type InterpolationContext,
} from "@/lib/broadcasts/interpolate";
import { participantEmailLocale } from "@/lib/i18n";
import { PreviewBodyZ } from "@/lib/broadcasts/api-schemas";
import type { AudienceFilter } from "@/lib/broadcasts/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/admin/broadcasts/:id/preview — render the broadcast against
// a single participant. Returns interpolated WhatsApp params + email
// subject/body for both locales, plus a flat list of any unresolved
// `${tokens}` so the composer can warn before send-time. Picks event +
// enrollment context from the broadcast's audience_filter (event-cohort
// mode only — master mode has no event context).
export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: ReturnType<typeof PreviewBodyZ.parse>;
  try {
    body = PreviewBodyZ.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "validation_error", detail: err instanceof Error ? err.message : "Invalid" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  const { data: broadcast } = await service
    .from("broadcasts")
    .select(
      "id, audience_mode, audience_filter, whatsapp_template_name, whatsapp_template_language, whatsapp_template_params, email_subject_en, email_subject_cn, email_body_en, email_body_cn",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!broadcast) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const b = broadcast as unknown as {
    audience_mode: "event_cohort" | "participant_master";
    audience_filter: AudienceFilter;
    whatsapp_template_name: string | null;
    whatsapp_template_language: string | null;
    whatsapp_template_params: Record<string, string> | null;
    email_subject_en: string | null;
    email_subject_cn: string | null;
    email_body_en: string | null;
    email_body_cn: string | null;
  };

  const { data: participant } = await service
    .from("participants")
    .select("id, name_cn, name_en, region_id, language_fluency")
    .eq("id", body.participant_id)
    .maybeSingle();
  if (!participant) return NextResponse.json({ error: "participant_not_found" }, { status: 404 });

  // Event + enrollment context (event-cohort mode only).
  let eventCtx: InterpolationContext["event"] = null;
  let enrollmentCtx: InterpolationContext["enrollment"] = null;
  if (b.audience_mode === "event_cohort" && b.audience_filter.mode === "event_cohort") {
    const eventId = b.audience_filter.event_id;
    const [eventRes, enrollmentRes] = await Promise.all([
      service
        .from("events")
        .select("title_en, title_cn, start_date, end_date, venue, main_venue_hotel_name, price")
        .eq("id", eventId)
        .maybeSingle(),
      service
        .from("enrollments")
        .select("id")
        .eq("event_id", eventId)
        .eq("participant_id", body.participant_id)
        .maybeSingle(),
    ]);
    if (eventRes.data) {
      eventCtx = eventRes.data as InterpolationContext["event"];
    }
    if (enrollmentRes.data) {
      enrollmentCtx = enrollmentRes.data as InterpolationContext["enrollment"];
    }
  }

  const ctx: InterpolationContext = {
    participant: {
      name_cn: (participant as { name_cn: string | null }).name_cn,
      name_en: (participant as { name_en: string | null }).name_en,
      region_id: (participant as { region_id: string | null }).region_id,
      language_fluency: (participant as { language_fluency: "en" | "cn" | "both" | null }).language_fluency,
    },
    event: eventCtx,
    enrollment: enrollmentCtx,
  };

  const locale = participantEmailLocale({
    language_fluency: ctx.participant.language_fluency,
  });

  const allUnresolved: string[] = [];
  const renderField = (s: string | null): { rendered: string; unresolved: string[] } | null => {
    if (!s) return null;
    const r = interpolateWithDiagnostics(s, ctx);
    allUnresolved.push(...r.unresolved);
    return r;
  };

  const whatsappParams: Record<string, { rendered: string; unresolved: string[] } | null> = {};
  if (b.whatsapp_template_params) {
    for (const [k, v] of Object.entries(b.whatsapp_template_params)) {
      whatsappParams[k] = renderField(v);
    }
  }

  return NextResponse.json({
    locale,
    participant: {
      id: body.participant_id,
      region_id: ctx.participant.region_id,
      name_cn: ctx.participant.name_cn,
      name_en: ctx.participant.name_en,
    },
    whatsapp: {
      template_name: b.whatsapp_template_name,
      template_language: b.whatsapp_template_language,
      params: whatsappParams,
    },
    email: {
      subject_en: renderField(b.email_subject_en),
      subject_cn: renderField(b.email_subject_cn),
      body_en: renderField(b.email_body_en),
      body_cn: renderField(b.email_body_cn),
    },
    unresolved_tokens: [...new Set(allUnresolved)],
  });
}
