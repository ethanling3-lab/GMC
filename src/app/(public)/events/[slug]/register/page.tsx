import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { loadSelfProfile } from "@/lib/participant-self";
import { QuickRegisterConfirm } from "./QuickRegisterConfirm";

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
      "id, slug, status, title_en, title_cn, start_date, end_date, venue, price, capacity, requires_approval",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();
  if ((event as { status: string }).status !== "open") {
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

  // Already enrolled? Skip the confirm screen.
  const { data: existing } = await service
    .from("enrollments")
    .select("id, status, payment_status")
    .eq("participant_id", participant.id)
    .eq("event_id", (event as { id: string }).id)
    .maybeSingle();
  if (existing) {
    redirect(`/me/enrollments?already=${(event as { id: string }).id}`);
  }

  const profile = await loadSelfProfile(participant.id);
  if (!profile) notFound();

  return (
    <section className="min-h-[calc(100dvh-160px)] px-4 md:px-8 py-10 max-w-[720px] mx-auto">
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        — Confirm · 确认报名
      </div>
      <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Confirm your registration.
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
        We already have your details. Just review and confirm — we&apos;ll take
        you to payment.
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
        price={(event as { price: number | string | null }).price}
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
