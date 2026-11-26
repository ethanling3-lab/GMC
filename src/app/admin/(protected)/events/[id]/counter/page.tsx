import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadCounterEvent, loadTakings } from "@/lib/payments/counter";
import { loadTemplates } from "@/lib/payments/ledger";
import { sgDay } from "@/lib/pricing/tiers";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { CounterClient, type CounterProgramme } from "@/components/admin/payments/CounterClient";

export const metadata: Metadata = { title: "Payment counter · 收款台" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// Payment counter · 收款台 (Phase 2, 2026-11-26). Finance + Super Admin.
export default async function CounterPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") redirect("/admin");
  const { id } = await params;
  const service = createSupabaseServiceClient();
  const event = await loadCounterEvent(service, id);
  if (!event) notFound();

  const [{ data: progs }, templates, takings] = await Promise.all([
    service
      .from("programmes")
      .select("id, name_cn, name_en, price_sgd, on_site_sgd")
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    loadTemplates(service, { activeOnly: true }),
    loadTakings(service, id, sgDay()),
  ]);
  const programmes: CounterProgramme[] = (progs ?? []).map((p) => ({
    id: p.id,
    name_cn: p.name_cn,
    name_en: p.name_en,
    price_sgd: Number(p.price_sgd),
    on_site_sgd: p.on_site_sgd == null ? null : Number(p.on_site_sgd),
  }));

  const title = event.title_cn || event.title_en || event.slug;
  const crumb = event.title_en && event.title_cn ? `${event.title_en} · ${event.title_cn}` : title;

  return (
    <div>
      <CrumbLabel segment={event.id} label={crumb} />
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Payment counter · 收款台
          </div>
          <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">{title}</h1>
          <p className="mt-2 max-w-[64ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
            Key in the paper form, take the card on the terminal, then record it here with the approval code.
          </p>
        </div>
        <div className="flex gap-2 text-[12.5px]">
          <Link href="/admin/finance/templates" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
            Payment plans
          </Link>
          <span className="text-[var(--ink-faint)]">·</span>
          <Link href="/admin/finance/instalments" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
            Instalments
          </Link>
        </div>
      </div>
      {programmes.length > 0 && templates.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--gold-soft)] px-3 py-2 text-[12.5px] text-[var(--ink)]">
          No payment plans yet, so programme deposits won&apos;t have a schedule.{" "}
          <Link href="/admin/finance/templates" className="underline underline-offset-2">Set up plans</Link> first if you can.
        </p>
      ) : null}
      <div className="mt-6">
        <CounterClient eventId={event.id} eventTitle={title} programmes={programmes} templates={templates} initialTakings={takings} canOpenProfile={admin.role === "super_admin"} />
      </div>
    </div>
  );
}
