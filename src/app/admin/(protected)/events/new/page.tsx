import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { NewEventForm } from "@/components/admin/events/NewEventForm";

export const metadata: Metadata = { title: "New event" };
export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    redirect("/admin/events?error=forbidden");
  }

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-5 h-px bg-current" />
          Create · 新建
        </div>
        <h1 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
          New event
        </h1>
      </div>
      <NewEventForm />
    </div>
  );
}
