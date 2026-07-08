import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-guard";
import { listProgrammes } from "@/lib/programmes/programmes";
import { validityLabel } from "@/lib/programmes/types";

export const metadata: Metadata = { title: "Programmes" };
export const dynamic = "force-dynamic";

function fmtSgd(n: number): string {
  return `S$${n.toLocaleString("en-SG", { maximumFractionDigits: 0 })}`;
}

export default async function ProgrammesPage() {
  const admin = await requireAdmin();
  const canManage = admin.role === "super_admin" || admin.role === "regional_lead";
  const programmes = await listProgrammes({ includeInactive: true });

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Offerings · 课程项目
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Programmes.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            The membership tiers that drive tiered pricing. Each carries a validity
            term — once a participant&apos;s membership lapses they revert to
            new/returning pricing.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/admin/programmes/new"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)] transition-colors"
            style={{ color: "var(--paper-warm)" }}
          >
            New programme →
          </Link>
        ) : null}
      </div>

      <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] border-b border-[var(--paper-shadow)]">
              <th className="px-5 py-3 font-normal">Programme</th>
              <th className="px-3 py-3 font-normal">Slug</th>
              <th className="px-3 py-3 font-normal">Validity</th>
              <th className="px-3 py-3 font-normal text-right">Price</th>
              <th className="px-3 py-3 font-normal text-right">On-site</th>
              <th className="px-3 py-3 font-normal">Status</th>
              {canManage ? <th className="px-5 py-3 font-normal" /> : null}
            </tr>
          </thead>
          <tbody>
            {programmes.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-5 py-10 text-center text-[var(--ink-faint)]">
                  No programmes yet.
                </td>
              </tr>
            ) : (
              programmes.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-[var(--paper-shadow)] even:bg-[var(--paper-deep)]/30"
                >
                  <td className="px-5 py-3">
                    <span className="text-[var(--ink)] font-display tracking-[-0.005em]">{p.name_cn}</span>
                    <span className="ml-2 text-[var(--ink-mute)]">{p.name_en}</span>
                    <span className="ml-2 text-[11px] text-[var(--ink-faint)]">{p.abbrev}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11.5px] text-[var(--ink-soft)]">{p.slug}</td>
                  <td className="px-3 py-3 text-[var(--ink-soft)]">{validityLabel(p.validity_months)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--ink)]">{fmtSgd(p.price_sgd)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--ink-soft)]">
                    {p.on_site_sgd != null ? fmtSgd(p.on_site_sgd) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {p.active ? (
                      <span className="text-[11px] tracking-[0.1em] uppercase text-[#3a6b3b]">Active</span>
                    ) : (
                      <span className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-faint)]">Inactive</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/programmes/${p.id}/edit`}
                        className="text-[12px] tracking-[0.04em] uppercase text-[var(--cinnabar)] hover:text-[var(--cinnabar-deep)]"
                        style={{ color: "var(--cinnabar)" }}
                      >
                        Edit
                      </Link>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
