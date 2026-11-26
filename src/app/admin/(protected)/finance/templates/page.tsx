import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadTemplates } from "@/lib/payments/ledger";
import { TemplatesClient } from "@/components/admin/payments/TemplatesClient";

export const metadata: Metadata = { title: "Payment plans · 付款方案" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") redirect("/admin");
  const service = createSupabaseServiceClient();
  const [templates, { data: progs }] = await Promise.all([
    loadTemplates(service),
    service.from("programmes").select("id, name_cn, name_en").is("deleted_at", null).order("sort_order", { ascending: true }),
  ]);
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Finance · 财务
      </div>
      <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">Payment plans · 付款方案</h1>
      <p className="mt-2 max-w-[64ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        Reusable schedules offered at the counter. Each buyer gets their own copy, which can be changed for them alone.
      </p>
      <p className="mt-2 text-[12.5px]">
        <Link href="/admin/finance/instalments" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
          ← Instalments
        </Link>
      </p>
      <div className="mt-6">
        <TemplatesClient templates={templates} programmes={(progs ?? []) as Array<{ id: string; name_cn: string; name_en: string }>} />
      </div>
    </div>
  );
}
