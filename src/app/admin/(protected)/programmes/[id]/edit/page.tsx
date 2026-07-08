import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { getProgrammeById } from "@/lib/programmes/programmes";
import { ProgrammeForm } from "@/components/admin/programmes/ProgrammeForm";

export const metadata: Metadata = { title: "Edit programme" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditProgrammePage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin/programmes");
  }

  const { id } = await params;
  const programme = await getProgrammeById(id);
  if (!programme) notFound();

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link href="/admin/programmes" className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Programmes · 课程
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span className="text-[var(--ink-mute)]">{programme.name_cn}</span>
      </div>
      <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        Edit programme.
      </h1>

      <section className="mt-10">
        <ProgrammeForm mode="edit" existing={programme} />
      </section>
    </div>
  );
}
