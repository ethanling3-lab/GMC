import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadInstalments, parseInstalmentFilters } from "@/lib/payments/instalments";
import { STATE_LABEL, sgd } from "@/lib/payments/types";
import { input, label, panel, primary, stateTone } from "@/components/admin/payments/ui";

export const metadata: Metadata = { title: "Instalments · 分期" };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const VIEWS = [
  { key: "chase", en: "To chase", cn: "待跟进" },
  { key: "active", en: "All paying", cn: "分期中" },
  { key: "completed", en: "Paid in full", cn: "完款" },
  { key: "cancelled", en: "Cancelled", cn: "已取消" },
] as const;

export default async function InstalmentsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  if (!["super_admin", "finance", "customer_service"].includes(admin.role)) redirect("/admin");
  const isCs = admin.role === "customer_service";
  const sp = await searchParams;
  const f = parseInstalmentFilters(sp);
  const service = createSupabaseServiceClient();

  const [rows, { data: progs }, { data: csList }] = await Promise.all([
    loadInstalments(service, f, { csId: isCs ? admin.id : null }),
    service.from("programmes").select("id, name_cn").is("deleted_at", null).order("sort_order", { ascending: true }),
    isCs
      ? Promise.resolve({ data: [] as Array<{ id: string; name_cn: string | null; name_en: string | null }> })
      : service.from("admins").select("id, name_cn, name_en").is("deactivated_at", null).in("role", ["customer_service", "super_admin"]).order("name_en"),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined> = { view: f.view, programme: f.programme, state: f.state, cs: f.cs, q: f.q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return u.toString();
  };
  const behindTotal = rows.reduce((s, r) => s + r.standing.behind, 0);
  const balanceTotal = rows.reduce((s, r) => s + r.standing.balance, 0);

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            {isCs ? "My customers · 我的学员" : "Finance · 财务"}
          </div>
          <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">Instalments · 分期付款</h1>
          <p className="mt-2 max-w-[64ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
            &ldquo;Behind&rdquo; means less paid than their own schedule says by now. &ldquo;To chase&rdquo; adds anyone with a payment due in the next 7 days.
          </p>
        </div>
        {!isCs ? (
          <div className="flex items-center gap-3 text-[12.5px]">
            <Link href="/admin/finance/templates" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
              Payment plans
            </Link>
            <Link href="/admin/finance/purchases/new" className={`${primary} h-9 px-4`} style={{ color: "var(--paper-warm)" }}>
              New purchase
            </Link>
          </div>
        ) : null}
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`?${qs({ view: v.key, state: undefined })}`}
            aria-current={f.view === v.key ? "page" : undefined}
            className={`inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] border text-[12.5px] transition-[border-color,background-color,color] duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] ${
              f.view === v.key
                ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]"
            }`}
          >
            {v.en} · {v.cn}
          </Link>
        ))}
      </nav>

      <form method="get" className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 items-end">
        <input type="hidden" name="view" value={f.view} />
        <label className="flex flex-col gap-1">
          <span className={label}>Search</span>
          <input className={input} name="q" defaultValue={f.q ?? ""} placeholder="Name, phone, student ID" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Programme</span>
          <select className={input} name="programme" defaultValue={f.programme ?? ""}>
            <option value="">All</option>
            {(progs ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name_cn}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Standing</span>
          <select className={input} name="state" defaultValue={f.state ?? ""}>
            <option value="">All</option>
            <option value="behind">逾期 Behind</option>
            <option value="unpaid">未付 Unpaid</option>
            <option value="partial">分期中 Paying</option>
            <option value="complete">完款 Paid in full</option>
          </select>
        </label>
        {!isCs ? (
          <label className="flex flex-col gap-1">
            <span className={label}>CS</span>
            <select className={input} name="cs" defaultValue={f.cs ?? ""}>
              <option value="">All</option>
              <option value="none">No CS</option>
              {(csList ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name_cn || c.name_en}</option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="submit" className={`${primary} h-9 px-4`} style={{ color: "var(--paper-warm)" }}>Filter</button>
          <a href={`/api/admin/finance/instalments/export?${qs({})}`} className="inline-flex items-center h-9 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,color,transform] duration-[var(--dur-fast)]">
            CSV
          </a>
        </div>
      </form>

      <p className="mt-5 text-[12.5px] text-[var(--ink-soft)]">
        {rows.length} purchase{rows.length === 1 ? "" : "s"} · balance {sgd(balanceTotal)}
        {behindTotal > 0 ? <span className="text-[#A8321F]"> · behind {sgd(behindTotal)}</span> : null}
      </p>

      <section className={`${panel} mt-3 p-0 overflow-x-auto`}>
        {rows.length === 0 ? (
          <p className="p-5 text-[13px] text-[var(--ink-faint)] italic">
            {f.view === "chase" ? "No one is behind or due in the next 7 days." : "No purchases here."}
          </p>
        ) : (
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-[var(--ink-mute)] border-b border-[var(--paper-shadow)]">
                <th className="px-4 py-2.5 font-normal">Person</th>
                <th className="px-4 py-2.5 font-normal">Purchase</th>
                <th className="px-4 py-2.5 font-normal text-right">Paid / total</th>
                <th className="px-4 py-2.5 font-normal">Next</th>
                <th className="px-4 py-2.5 font-normal">Standing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = r.standing;
                const href = isCs ? `/admin/participants/${r.person.id}` : `/admin/finance/purchases/${r.id}`;
                return (
                  <tr key={r.id} className="border-b border-[var(--paper-shadow)] last:border-b-0 hover:bg-[var(--paper-deep)]/50">
                    <td className="px-4 py-2.5 align-top">
                      <Link href={href} className="text-[var(--ink)] underline decoration-[var(--paper-shadow)] underline-offset-2 hover:text-[var(--cinnabar-deep)]">
                        {r.person.name}
                      </Link>
                      {r.person.region_id ? <span className="ml-1.5 font-mono text-[11px] text-[var(--ink-mute)]">{r.person.region_id}</span> : null}
                      <div className="text-[12px] text-[var(--ink-soft)]">
                        {[r.person.phone, r.person.cs_name ? `CS ${r.person.cs_name}` : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="text-[var(--ink)]">{r.title}</div>
                      <div className="text-[12px] text-[var(--ink-soft)]">registered {r.registered_on}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top text-right tabular-nums">
                      <div className="text-[var(--ink)]">{sgd(s.paid)}</div>
                      <div className="text-[12px] text-[var(--ink-mute)]">of {sgd(s.total)}</div>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      {s.next ? (
                        <>
                          <div className="text-[var(--ink)]">{s.next.label} · {sgd(s.next.remaining)}</div>
                          <div className={`text-[12px] tabular-nums ${r.due_soon ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-soft)]"}`}>
                            {s.next.due_on ? `due ${s.next.due_on}` : "no date"}
                          </div>
                        </>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] whitespace-nowrap ${stateTone[s.state]}`}>
                        {STATE_LABEL[s.state].cn}
                        {s.state === "behind" ? ` ${sgd(s.behind)}` : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
