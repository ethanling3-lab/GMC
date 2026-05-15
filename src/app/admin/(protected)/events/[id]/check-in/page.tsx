import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { loadCheckInPage } from "@/lib/check-in/check-in-query";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { CheckInClient } from "@/components/admin/check-in/CheckInClient";

export const metadata: Metadata = { title: "Check-in" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
  "instructor",
]);

export default async function EventCheckInPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    redirect("/admin");
  }
  const { id } = await params;

  const data = await loadCheckInPage(id);
  if (!data) notFound();

  const title = data.event.title_en || data.event.title_cn || data.event.slug;
  const crumb =
    data.event.title_en && data.event.title_cn
      ? `${data.event.title_en} · ${data.event.title_cn}`
      : title;

  return (
    <>
      <CrumbLabel segment={data.event.id} label={crumb} />
      <CheckInClient
        eventId={data.event.id}
        eventSlug={data.event.slug}
        eventTitle={title}
        eventTitleCn={data.event.title_cn}
        eventStartDate={data.event.start_date}
        initialStats={data.stats}
        initialRecent={data.recent}
        initialVelocity={data.velocity}
        initialGroups={data.groups}
        initialAbsent={data.absent}
        initialBuckets={data.buckets}
      />
      <p className="mt-8 text-[11px] text-[var(--ink-faint)]">
        Tip · 提示 · Open the scanner station on a phone or tablet at the
        venue door — both surfaces sync within one 5-second poll.
      </p>
      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        <Link
          href={`/admin/events/${id}`}
          className="underline decoration-dotted underline-offset-4 hover:text-[var(--cinnabar)]"
          style={{ color: "var(--ink-faint)" }}
        >
          ← Back to event
        </Link>
      </p>
    </>
  );
}
