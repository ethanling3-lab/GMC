import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { buildRegistrationSchemaFor } from "@/lib/validation";
import { verifyPrefillToken } from "@/lib/tokens";
import { normalizeFormSchema } from "@/lib/event-form-schema";
import {
  upsertParticipant,
  updateExistingParticipant,
  type ParticipantInsertInput,
} from "@/lib/participants-write";
import { isEventFull } from "@/lib/event-capacity";
import { setMarketingStatus } from "@/lib/whatsapp/consent";
import { registrationBlock } from "@/lib/event-registration-window";
import { sendParticipantAccountLink } from "@/lib/participant-invite";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/register — public sign-up for an event (Phase 5, Ethan
// 2026-11-26). Registering needs an account, so this no longer creates an
// enrolment. It saves the person's details and emails a one-time "set your
// password" link that lands them, signed in, on /events/<slug>/register to
// answer the event's questions and confirm.
//
//   • Email already has an account → nothing is changed; they're told to
//     sign in (409 account_exists).
//   • Otherwise their record is created or updated, then the link is sent.

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const presliced = z
    .object({ event_slug: z.string().min(1), prefill_token: z.string().max(200).optional() })
    .passthrough()
    .safeParse(body);
  if (!presliced.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, slug, status, title_en, title_cn, enrollment_opens_at, enrollment_closes_at, capacity, form_schema")
    .eq("slug", presliced.data.event_slug)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (event.status !== "open" || registrationBlock(event)) {
    return NextResponse.json({ error: "event_not_open" }, { status: 409 });
  }
  if (await isEventFull(supabase, event.id, event.capacity)) {
    return NextResponse.json({ error: "no_seats" }, { status: 409 });
  }

  // The event's own questions are asked after sign-in, so only the
  // identity part of the form is checked here.
  const formSchema = normalizeFormSchema(event.form_schema);
  const parsed = buildRegistrationSchemaFor(formSchema.identity, { ...formSchema, fields: [] }).safeParse({
    ...(body as Record<string, unknown>),
    answers: {},
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const input = parsed.data;

  const prefill = input.prefill_token ? verifyPrefillToken(input.prefill_token) : null;
  if (input.prefill_token && !prefill) {
    return NextResponse.json({ error: "prefill_invalid" }, { status: 400 });
  }

  const next = `/events/${encodeURIComponent(event.slug)}/register`;

  // Already has an account? Leave the record alone and send them to sign in.
  const { data: sameEmail } = await supabase
    .from("participants")
    .select("id, auth_user_id")
    .ilike("email", input.email);
  const byEmail = (sameEmail ?? []) as Array<{ id: string; auth_user_id: string | null }>;
  let prefillLinked = false;
  if (prefill) {
    const { data: pre } = await supabase.from("participants").select("auth_user_id").eq("id", prefill.participantId).maybeSingle();
    prefillLinked = Boolean(pre?.auth_user_id);
  }
  if (prefillLinked || byEmail.some((p) => p.auth_user_id)) {
    return NextResponse.json({ error: "account_exists", next }, { status: 409 });
  }

  const resolvedRegion =
    input.region === "OTHER" && input.region_other && input.region_other.trim() ? input.region_other.trim() : input.region;
  const resolvedFluency: "en" | "cn" | null = input.language === "zh" ? "cn" : input.language === "en" ? "en" : null;

  const participantInput: ParticipantInsertInput = {
    name_en: input.name_en,
    name_cn: input.name_cn || null,
    email: input.email,
    phone: input.phone,
    region: resolvedRegion,
    language_fluency: resolvedFluency,
    gender: input.gender,
    birth_date: input.birth_date || null,
    occupation: input.occupation || null,
    industry: input.industry || null,
    referrer_name: input.referrer_name?.trim() || null,
    referrer_contact: input.referrer_contact?.trim() || null,
  };

  // One record per email: update the person we already have (prefill link,
  // or the single record with this email) instead of making a second one,
  // which would block linking the account later.
  let participantId: string;
  try {
    const existingId = prefill?.participantId ?? (byEmail.length === 1 ? byEmail[0].id : null);
    const saved = existingId
      ? await updateExistingParticipant(supabase, existingId, participantInput)
      : await upsertParticipant(supabase, participantInput);
    if (!saved) return NextResponse.json({ error: "prefill_invalid" }, { status: 400 });
    participantId = saved.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "insert_failed";
    console.error("[/api/register] participant save failed", { detail: msg });
    return NextResponse.json({ error: "insert_failed", detail: msg }, { status: 500 });
  }

  if (input.marketing_opt_in === true) {
    try {
      await setMarketingStatus(supabase, { participantId, status: "subscribed", source: "registration", actorId: null });
    } catch (err) {
      console.warn("[/api/register] marketing opt-in failed", err);
    }
  }

  const title = event.title_cn || event.title_en || event.slug;
  const titleEn = event.title_en || event.title_cn || event.slug;
  const sent = await sendParticipantAccountLink(input.email, input.name_cn || input.name_en, {
    next,
    intro: {
      en: `Thanks for signing up for ${titleEn}. To finish registering, set a password for your GMC account — you'll then confirm your place.`,
      zh: `感谢您报名「${title}」。请先设置 GMC 账户密码，然后确认报名。`,
    },
  });

  await writeAuditLog({
    actor_id: null,
    action: "participant.account_invite_sent",
    entity: "participants",
    entity_id: participantId,
    metadata: { via: "public_signup", event_id: event.id, link: sent.status },
  });

  return NextResponse.json({
    success: true,
    check_email: true,
    // "cooldown" = a link went out in the last 5 minutes; "failed" = we
    // couldn't email it (they can request one from the sign-in page).
    link: sent.status,
    // Development only, so the flow can be clicked through locally.
    ...(process.env.NODE_ENV === "development" && sent.status === "sent" ? { dev_account_url: sent.url } : {}),
  });
}
