import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { lastFxRate, loadPurchase, loadTemplates } from "@/lib/payments/ledger";
import { PURCHASE_KINDS } from "@/lib/payments/types";
import { PurchaseClient } from "@/components/admin/payments/PurchaseClient";
import { NewPurchaseClient } from "@/components/admin/payments/NewPurchaseClient";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Programme purchase · 配套付款" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ participant?: string }> };

function Header({ title, sub, back }: { title: string; sub?: React.ReactNode; back: React.ReactNode }) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Programme purchase · 配套付款
      </div>
      <h1 className="mt-3 font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">{title}</h1>
      {sub ? <div className="mt-2 text-[13.5px] text-[var(--ink-soft)]">{sub}</div> : null}
      <p className="mt-2 text-[12.5px]">{back}</p>
    </div>
  );
}

const linkCls = "underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]";

export default async function PurchasePage({ params, searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") redirect("/admin");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const service = createSupabaseServiceClient();

  if (id === "new") {
    const [{ data: progs }, templates] = await Promise.all([
      service.from("programmes").select("id, name_cn, name_en, price_sgd").is("deleted_at", null).order("sort_order", { ascending: true }),
      loadTemplates(service),
    ]);
    let initialPerson: { id: string; name: string; region_id: string | null } | null = null;
    if (sp.participant && /^[0-9a-f-]{36}$/i.test(sp.participant)) {
      const { data: p } = await service.from("participants").select("id, name_cn, name_en, region_id").eq("id", sp.participant).maybeSingle();
      if (p) initialPerson = { id: p.id, name: p.name_cn || p.name_en || "—", region_id: p.region_id };
    }
    return (
      <div>
        <Header title="New purchase" sub="For a programme bought away from the counter. Add payments on the next page." back={<Link href="/admin/finance/instalments" className={linkCls}>← Instalments</Link>} />
        <div className="mt-6 max-w-[860px]">
          <NewPurchaseClient
            programmes={(progs ?? []).map((p) => ({ id: p.id, name_cn: p.name_cn, name_en: p.name_en, price_sgd: Number(p.price_sgd) }))}
            templates={templates}
            initialPerson={initialPerson}
          />
        </div>
      </div>
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const purchase = await loadPurchase(service, id);
  if (!purchase) notFound();
  const [{ data: p }, fx] = await Promise.all([
    service.from("participants").select("id, name_cn, name_en, region_id, phone").eq("id", purchase.participant_id).maybeSingle(),
    lastFxRate(service, admin.id),
  ]);
  const who = p ? p.name_cn || p.name_en || "—" : "—";
  const kind = PURCHASE_KINDS.find((k) => k.value === purchase.kind);
  return (
    <div>
      <CrumbLabel segment={purchase.id} label={`${purchase.title} · ${who}`} />
      <Header
        title={purchase.title}
        sub={
          <>
            {admin.role === "super_admin" && p ? (
              <Link href={`/admin/participants/${p.id}`} className="underline underline-offset-2 hover:text-[var(--cinnabar-deep)]">{who}</Link>
            ) : (
              who
            )}
            {p?.region_id ? <span className="ml-1.5 font-mono text-[12px] text-[var(--ink-mute)]">{p.region_id}</span> : null}
            {p?.phone ? ` · ${p.phone}` : ""} · {kind?.cn ?? purchase.kind} · registered {purchase.registered_on}
            {purchase.programme_name ? ` · ${purchase.programme_name}` : ""}
          </>
        }
        back={<Link href="/admin/finance/instalments" className={linkCls}>← Instalments</Link>}
      />
      <div className="mt-6 max-w-[920px]">
        <PurchaseClient purchase={purchase} lastFx={fx} />
      </div>
    </div>
  );
}
