import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { loadStaff } from "@/lib/staff/staff";
import { StaffManager } from "@/components/admin/staff/StaffManager";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin");
  const staff = await loadStaff();

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Team · 员工
      </div>
      <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        Staff.
      </h1>
      <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
        Invite your team, choose what each person can do, and remove access when
        they leave.
      </p>
      <StaffManager staff={staff} currentAdminId={admin.id} />
    </div>
  );
}
