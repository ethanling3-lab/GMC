import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-guard";
import { adminSegmentFromPathname } from "@/lib/admin-segment";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: { template: "%s · GMC Admin", default: "GMC Admin" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  // The active nav segment is derived server-side from the `x-pathname`
  // middleware header so SSR and the first client render agree. The client
  // switches to the live `useSelectedLayoutSegment()` after mount (see
  // AdminShell) for client-side navigation updates.
  const hdrs = await headers();
  const initialSegment = adminSegmentFromPathname(hdrs.get("x-pathname"));

  return (
    <AdminShell admin={admin} initialSegment={initialSegment}>
      {children}
    </AdminShell>
  );
}
