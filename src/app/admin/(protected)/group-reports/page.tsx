import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { TemplateListClient, type TemplateRow } from "@/components/admin/group-reports/TemplateListClient";

export const metadata: Metadata = { title: "Group reports · 小组报告 — Admin" };
export const dynamic = "force-dynamic";

export default async function GroupReportsPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin");
  }

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("group_report_templates")
    .select("id, name_en, name_cn, active, updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const templates = (data ?? []) as TemplateRow[];

  return (
    <div>
      <div>
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          Group reports · 小组报告
        </div>
        <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Report templates.
        </h1>
        <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[64ch]">
          Build the 小组报告 questions once (a group summary section + a per-member
          section), then activate a template on any event. Group leaders fill it
          from their portal; export all reports as XLSX.
        </p>
      </div>

      <TemplateListClient initial={templates} />
    </div>
  );
}
