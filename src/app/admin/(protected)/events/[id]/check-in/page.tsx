import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { loadCheckInPage } from "@/lib/check-in/check-in-query";
import { todayInEventTz } from "@/lib/check-in/day";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { CheckInClient } from "@/components/admin/check-in/CheckInClient";
import { ServiceWorkerRegister } from "@/components/admin/check-in/ServiceWorkerRegister";

export const dynamic = "force-dynamic";

// "Add to Home Screen" on a desk iPad installs this page fullscreen with its
// own icon and name (manifest route still lives under /scan for stable URLs).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Check-in · 签到",
    manifest: `/admin/events/${id}/check-in/scan/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "GMC Check-in",
    },
    other: {
      "apple-touch-icon": "/icons/gmc-scan-apple-touch.png",
      "mobile-web-app-capable": "yes",
    },
  };
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ day?: string }>;
};

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
  "instructor",
]);

export default async function EventCheckInPage({ params, searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) {
    redirect("/admin");
  }
  const [{ id }, { day: dayParam }] = await Promise.all([params, searchParams]);

  const data = await loadCheckInPage(id, dayParam ?? null);
  if (!data) notFound();

  const title = data.event.title_en || data.event.title_cn || data.event.slug;
  const crumb =
    data.event.title_en && data.event.title_cn
      ? `${data.event.title_en} · ${data.event.title_cn}`
      : title;

  return (
    <>
      <CrumbLabel segment={data.event.id} label={crumb} />
      <ServiceWorkerRegister />
      {/* Keyed by day so switching days starts from that day's snapshot. */}
      <CheckInClient
        key={data.day}
        eventId={data.event.id}
        eventSlug={data.event.slug}
        eventTitle={title}
        eventTitleCn={data.event.title_cn}
        days={data.days}
        day={data.day}
        today={todayInEventTz()}
        initial={{
          stats: data.stats,
          recent: data.recent,
          groups: data.groups,
          absent: data.absent,
        }}
      />
      <p className="mt-8 text-[12px] text-[var(--ink-faint)]">
        Each desk can open this page on its own phone or tablet — every desk
        sees the others&apos; scans within 5 seconds · 各签到台可在自己的设备上打开此页，5 秒内互相同步。
      </p>
      <p className="mt-2 text-[12px] text-[var(--ink-faint)]">
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
