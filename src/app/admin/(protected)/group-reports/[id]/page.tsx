import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { GroupReportTemplateBuilder } from "@/components/admin/group-reports/GroupReportTemplateBuilder";

export const metadata: Metadata = { title: "Edit template · 小组报告 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function GroupReportTemplatePage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin");
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("group_report_templates")
    .select("id, name_en, name_cn, schema")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const t = data as { id: string; name_en: string | null; name_cn: string | null; schema: unknown };
  const name = t.name_cn ?? t.name_en ?? "Template";

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)] flex-wrap">
        <Link href="/admin/group-reports" className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Group reports · 小组报告
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span>Edit template</span>
      </div>
      <h1 className="mt-4 font-display text-[30px] md:text-[34px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        {name}
      </h1>
      <p className="mt-2 text-[13.5px] text-[var(--ink-soft)] max-w-[64ch]">
        Add questions (MCQ, text, date…) to the group-summary and per-member
        sections. Preview each section, then save.
      </p>

      <GroupReportTemplateBuilder
        templateId={t.id}
        initialNameEn={t.name_en}
        initialNameCn={t.name_cn}
        initialSchema={t.schema}
      />
    </div>
  );
}
