import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { ProgrammeForm } from "@/components/admin/programmes/ProgrammeForm";

export const metadata: Metadata = { title: "New programme" };
export const dynamic = "force-dynamic";

export default async function NewProgrammePage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin/programmes");
  }

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link href="/admin/programmes" className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Programmes · 课程
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span className="text-[var(--ink-mute)]">New · 新建</span>
      </div>
      <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        New programme.
      </h1>
      <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
        The slug becomes the pricing key used in event price tiers, so choose it
        deliberately — it can&apos;t be changed later.
      </p>

      <section className="mt-10">
        <ProgrammeForm mode="create" />
      </section>
    </div>
  );
}
