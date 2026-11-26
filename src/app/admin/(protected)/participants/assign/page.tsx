import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadAssignQueue } from "@/lib/participants/assign-queue";
import { AssignQueueClient } from "@/components/admin/participants/AssignQueueClient";

export const metadata: Metadata = { title: "To assign · 待分配" };
export const dynamic = "force-dynamic";

// New sign-ups without a CS (Phase 3, 2026-11-26). Super Admin only.
export default async function AssignQueuePage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin/participants");
  const service = createSupabaseServiceClient();
  const [{ rows, total }, { data: csData }] = await Promise.all([
    loadAssignQueue(),
    service
      .from("admins")
      .select("id, name_cn, name_en")
      .is("deactivated_at", null)
      .in("role", ["customer_service", "super_admin"])
      .order("name_en", { ascending: true, nullsFirst: false }),
  ]);
  const cs = (csData ?? []).map((c) => ({ id: c.id as string, name: (c.name_cn || c.name_en || "CS") as string }));

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Participants · 学员
      </div>
      <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">To assign · 待分配</h1>
      <p className="mt-2 max-w-[66ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        People without a CS yet, newest first. Check who brought them, then assign. When the person who brought them (or a child&apos;s
        parent) already has a CS, that CS is suggested.
      </p>
      <p className="mt-2 text-[12.5px]">
        <Link href="/admin/participants?cs=none" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
          Open as a filtered list
        </Link>
        {total > rows.length ? <span className="ml-2 text-[var(--ink-mute)]">Showing the newest {rows.length} of {total}.</span> : null}
      </p>
      <div className="mt-6">
        <AssignQueueClient rows={rows} cs={cs} />
      </div>
    </div>
  );
}
