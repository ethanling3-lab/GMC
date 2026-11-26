import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { loadSelfProfile } from "@/lib/participant-self";
import { QuickRegisterConfirm } from "./QuickRegisterConfirm";
import { registrationBlock } from "@/lib/event-registration-window";
import { currentEventSlug } from "@/lib/event-slug";
import type { PriceTier } from "@/lib/pricing/tiers";
import { resolveEnrollmentPrice } from "@/lib/pricing/resolve-server";
import { childrenOf } from "@/lib/participants/children";
import { normalizeFormSchema } from "@/lib/event-form-schema";
import { missingProfileFields, REQUIRED_PROFILE_COLUMNS, type RequiredProfile } from "@/lib/participants/required-profile";

export const metadata: Metadata = { title: "Register · 报名 — GMC" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

// /events/[slug]/register — branches on session:
//   - Not logged in → redirects to the public /register?event=<slug>
//     flow which collects all fields fresh.
//   - Logged in → renders QuickRegisterConfirm with pre-filled profile
//     summary and a single "Confirm & pay" CTA.

export default async function EventRegisterPage({ params }: PageProps) {
  const { slug } = await params;

  const moved = await currentEventSlug(createSupabaseServiceClient(), slug);
  if (moved) redirect(`/events/${encodeURIComponent(moved)}/register`);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/register?event=${encodeURIComponent(slug)}`);
  }

  // Look up participant via auth_user_id (use service-role for the
  // participant_self read so we don't hit RLS edge cases).
  const service = createSupabaseServiceClient();
  const { data: participant } = await service
    .from("participants")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!participant) {
    // Auth user not linked yet — send them through the public flow.
    redirect(`/register?event=${encodeURIComponent(slug)}`);
  }

  // Load event.
  const { data: event } = await service
    .from("events")
    .select(
      "id, slug, status, title_en, title_cn, start_date, end_date, venue, price, misc_fee, price_tiers, course_id, currency, capacity, requires_approval, enrollment_opens_at, enrollment_closes_at, form_schema",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();
  const windowFields = event as {
    enrollment_opens_at: string | null;
    enrollment_closes_at: string | null;
  };
  if ((event as { status: string }).status !== "open" || registrationBlock(windowFields)) {
    return (
      <section className="min-h-[calc(100dvh-200px)] flex items-center justify-center px-6 py-16">
        <div className="max-w-[420px] text-center">
          <h1 className="font-display text-[28px] text-[var(--ink)]">
            Registration closed · 报名已截止
          </h1>
          <p className="mt-3 text-[13.5px] text-[var(--ink-soft)]">
            This event is no longer accepting new registrations.
          </p>
          <Link
            href="/events"
            className="mt-6 inline-block text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
            style={{ color: "var(--cinnabar-deep)" }}
          >
            ← See other events
          </Link>
        </div>
      </section>
    );
  }

  // Who could attend: the person and their children (migration 084).
  const children = await childrenOf(participant.id, service);
  const familyIds = [participant.id, ...children.map((c) => c.id)];
  const { data: existingRows } = await service
    .from("enrollments")
    .select("participant_id")
    .eq("event_id", (event as { id: string }).id)
    .in("participant_id", familyIds);
  const enrolled = new Set((existingRows ?? []).map((r) => (r as { participant_id: string }).participant_id));
  // Everyone already registered and no children to add? Skip the screen.
  if (enrolled.has(participant.id) && children.length === 0) {
    redirect(`/me/enrollments?already=${(event as { id: string }).id}`);
  }

  const profile = await loadSelfProfile(participant.id);
  if (!profile) notFound();
  // Phase 5: the six required details, and the event's own questions.
  const { data: reqRow } = await service.from("participants").select(REQUIRED_PROFILE_COLUMNS).eq("id", participant.id).maybeSingle();
  const required = (reqRow ?? {
    name_cn: null, name_en: null, phone: null, occupation: null, industry: null, referrer_name: null, referrer_contact: null,
  }) as unknown as RequiredProfile;
  const missing = missingProfileFields(required);
  const formSchema = normalizeFormSchema((event as { form_schema?: unknown }).form_schema);

  // Show the amount this person will actually be charged — same shared
  // rule the register API uses, so preview and charge always match.
  const priced = event as {
    id: string;
    price: number | string | null;
    misc_fee: number | string | null;
    price_tiers: PriceTier[] | null;
    course_id: string | null;
    start_date: string | null;
    currency: string | null;
  };
  const { amount_due: amountDue } = await resolveEnrollmentPrice(priced, participant.id, service);
  const attendees = await Promise.all(
    [{ id: participant.id, name: profile.name_cn || profile.name_en || "Me", is_self: true, birth_date: null as string | null }]
      .concat(children.map((c) => ({ id: c.id, name: c.name_cn || c.name_en || "Child", is_self: false, birth_date: c.birth_date })))
      .map(async (a) => ({
        ...a,
        enrolled: enrolled.has(a.id),
        amount_due: a.is_self ? amountDue : (await resolveEnrollmentPrice(priced, a.id, service)).amount_due,
      })),
  );

  return (
    <section className="min-h-[calc(100dvh-160px)] px-4 md:px-8 py-10 max-w-[720px] mx-auto">
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        — Confirm · 确认报名
      </div>
      <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Confirm your registration.
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
        {missing.length > 0
          ? "First, add the details every registration needs. Then confirm and we'll take you to payment."
          : "We already have your details. Just review and confirm, and we'll take you to payment."}
      </p>

      <QuickRegisterConfirm
        eventSlug={(event as { slug: string }).slug}
        eventTitle={
          (event as { title_cn: string | null; title_en: string | null }).title_cn ??
          (event as { title_en: string | null }).title_en ??
          ""
        }
        eventTitleAlt={
          (event as { title_en: string | null }).title_en ??
          (event as { title_cn: string | null }).title_cn ??
          ""
        }
        startDate={(event as { start_date: string | null }).start_date}
        venue={(event as { venue: string | null }).venue}
        price={amountDue}
        attendees={attendees}
        required={required}
        missing={missing}
        formSchema={formSchema}
        currency={priced.currency ?? "SGD"}
        profile={{
          name_cn: profile.name_cn,
          name_en: profile.name_en,
          email: profile.email,
          phone: profile.phone,
          region: profile.region,
          language_fluency: profile.language_fluency,
          region_id: profile.region_id,
        }}
      />
    </section>
  );
}
