import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadBadgeSettings } from "@/lib/badges/load";
import { BadgesClient } from "@/components/admin/badges/BadgesClient";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Badges · 名牌 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ enrollment?: string }>;
};

export default async function EventBadgesPage({ params, searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    redirect("/admin/events");
  }
  const { id } = await params;
  const { enrollment } = await searchParams;

  const service = createSupabaseServiceClient();
  const { data: ev } = await service
    .from("events")
    .select("id, slug, title_en, title_cn")
    .eq("id", id)
    .maybeSingle();
  if (!ev) notFound();
  const title = (ev.title_cn ?? ev.title_en ?? ev.slug) as string;

  const { bg_storage_path: _p, ...settings } = await loadBadgeSettings(service, id);
  const canEdit = admin.role === "super_admin" || admin.role === "regional_lead";

  return (
    <div>
      <CrumbLabel segment={ev.id as string} label={title} />
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)] flex-wrap">
        <Link
          href={`/admin/events/${id}`}
          className="hover:text-[var(--cinnabar-deep)]"
          style={{ color: "var(--cinnabar)" }}
        >
          {title}
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span>Badges · 名牌</span>
      </div>
      <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Name badges.
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[64ch]">
        Upload the badge design, pick a colour for the name and QR, then download
        every paid attendee&apos;s badge as one PDF — 10 per A4 page, sorted by group
        and seat, ready to cut.
      </p>

      <BadgesClient
        eventId={ev.id as string}
        eventSlug={ev.slug as string}
        initialSettings={settings}
        canEdit={canEdit}
        initialEnrollmentId={enrollment ?? null}
      />
    </div>
  );
}
