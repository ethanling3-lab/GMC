import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { loadCheckInPage } from "@/lib/check-in/check-in-query";
import { loadFaceBank } from "@/lib/face-recognition/load-bank";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { ScannerStation } from "@/components/admin/check-in/ScannerStation";
import { FaceScannerStation } from "@/components/admin/check-in/FaceScannerStation";
import { UnifiedScannerStation } from "@/components/admin/check-in/UnifiedScannerStation";
import { ServiceWorkerRegister } from "@/components/admin/check-in/ServiceWorkerRegister";

export const dynamic = "force-dynamic";

// M7.1d — per-event metadata so "Add to Home Screen" on iPad Mini gives
// a fullscreen install with the right title + the dynamic manifest URL.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Scan · 签到",
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
  searchParams: Promise<{ threshold?: string }>;
};

const ALLOWED_ROLES = new Set([
  "super_admin",
  "regional_lead",
  "customer_service",
  "instructor",
]);

// M7.1d — per-event scanner dispatch. Reads `event.check_in_method` and
// renders the appropriate station:
//   - 'qr'   → ScannerStation (legacy QR-only flow from M7.1)
//   - 'face' → FaceScannerStation (M7.1c face recognition)
//   - 'both' → UnifiedScannerStation (parallel face + QR detectors)
//
// The face-bank is only loaded when the event mode needs it.

export default async function CheckInScanPage({
  params,
  searchParams,
}: PageProps) {
  const admin = await requireAdmin();
  if (!ALLOWED_ROLES.has(admin.role)) redirect("/admin");

  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const data = await loadCheckInPage(id);
  if (!data) notFound();

  const mode = data.event.check_in_method;
  const needsBank = mode === "face" || mode === "both";
  const faceBank = needsBank
    ? await loadFaceBank(id)
    : { bank: [], summary: { total_eligible: 0, with_consent: 0, with_embedding: 0 } };

  const title = data.event.title_en || data.event.title_cn || data.event.slug;
  const crumb =
    data.event.title_en && data.event.title_cn
      ? `${data.event.title_en} · ${data.event.title_cn}`
      : title;

  // ?threshold=0.55 override for admin tuning (face + both modes only).
  const thresholdRaw = sp.threshold ? Number(sp.threshold) : NaN;
  const thresholdOverride =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 0.2 && thresholdRaw <= 1.2
      ? thresholdRaw
      : null;

  return (
    <>
      <CrumbLabel segment={data.event.id} label={crumb} />
      <ServiceWorkerRegister />
      {mode === "qr" ? (
        <ScannerStation
          eventId={data.event.id}
          eventSlug={data.event.slug}
          eventTitle={title}
          eventTitleCn={data.event.title_cn}
          initialStats={data.stats}
        />
      ) : mode === "face" ? (
        <FaceScannerStation
          eventId={data.event.id}
          eventSlug={data.event.slug}
          eventTitle={title}
          eventTitleCn={data.event.title_cn}
          initialStats={data.stats}
          bank={faceBank.bank}
          bankSummary={faceBank.summary}
          thresholdOverride={thresholdOverride}
        />
      ) : (
        <UnifiedScannerStation
          eventId={data.event.id}
          eventSlug={data.event.slug}
          eventTitle={title}
          eventTitleCn={data.event.title_cn}
          initialStats={data.stats}
          bank={faceBank.bank}
          bankSummary={faceBank.summary}
          thresholdOverride={thresholdOverride}
        />
      )}
    </>
  );
}
