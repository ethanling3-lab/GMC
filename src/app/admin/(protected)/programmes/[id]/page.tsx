import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { getProgrammeById } from "@/lib/programmes/programmes";
import { validityLabel } from "@/lib/programmes/types";
import { listCourses, listProgrammeCourses } from "@/lib/programmes/courses";
import { ProgrammeCourses } from "@/components/admin/programmes/ProgrammeCourses";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Programme" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// A programme and the courses it includes (migration 079). All staff who
// can open Programmes read it; Super Admin edits the list.
export default async function ProgrammePage({ params }: PageProps) {
  const admin = await requireAdmin();
  const canEdit = admin.role === "super_admin" || admin.role === "regional_lead";
  const { id } = await params;
  const programme = await getProgrammeById(id);
  if (!programme) notFound();

  const [items, allCourses] = await Promise.all([listProgrammeCourses(id), canEdit ? listCourses() : Promise.resolve([])]);

  return (
    <div>
      <CrumbLabel segment={programme.id} label={`${programme.name_cn} · ${programme.name_en}`} />
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link href="/admin/programmes" className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Programmes · 课程
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span className="text-[var(--ink-mute)]">{programme.name_cn}</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            {programme.name_cn}
            <span className="ml-3 text-[22px] text-[var(--ink-mute)]">{programme.name_en}</span>
          </h1>
          <p className="mt-3 text-[13.5px] text-[var(--ink-soft)]">
            Validity {validityLabel(programme.validity_months)} · S$
            {programme.price_sgd.toLocaleString("en-SG", { maximumFractionDigits: 0 })}
            {programme.active ? "" : " · Inactive"}
          </p>
        </div>
        {canEdit ? (
          <Link
            href={`/admin/programmes/${programme.id}/edit`}
            className="inline-flex items-center h-10 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,color,transform] duration-[var(--dur-fast)]"
          >
            Edit programme details
          </Link>
        ) : null}
      </div>

      <ProgrammeCourses
        programmeId={programme.id}
        programmeName={programme.name_cn}
        items={items}
        allCourses={allCourses}
        canEdit={canEdit}
        canPlan={admin.role === "super_admin"}
        planYear={new Date(Date.now() + 8 * 3600_000).getUTCFullYear()}
      />
    </div>
  );
}
