import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-guard";
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
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
