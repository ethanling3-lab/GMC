import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-guard";
import { listProgrammes } from "@/lib/programmes/programmes";
import { validityLabel } from "@/lib/programmes/types";
import { courseCountsByProgramme, listUnlinkedCourseHistory } from "@/lib/programmes/courses";

export const metadata: Metadata = { title: "Programmes" };
export const dynamic = "force-dynamic";

function fmtSgd(n: number): string {
  return `S$${n.toLocaleString("en-SG", { maximumFractionDigits: 0 })}`;
}

export default async function ProgrammesPage() {
  const admin = await requireAdmin();
  const canManage = admin.role === "super_admin" || admin.role === "regional_lead";
  const [programmes, courseCounts, unlinked] = await Promise.all([
    listProgrammes({ includeInactive: true }),
    courseCountsByProgramme(),
    // Names participants, so Super Admin only (CS see their own customers).
    admin.role === "super_admin" ? listUnlinkedCourseHistory() : Promise.resolve([]),
  ]);
  const unlinkedEntries = unlinked.reduce((n, u) => n + u.entries.length, 0);

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
            term and its own list of included courses — open a programme to see
            them.
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
              <th className="px-3 py-3 font-normal">Courses</th>
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
                <td colSpan={canManage ? 8 : 7} className="px-5 py-10 text-center text-[var(--ink-faint)]">
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
                    <Link
                      href={`/admin/programmes/${p.id}`}
                      className="group rounded-sm focus-visible:shadow-[var(--shadow-focus)]"
                    >
                      <span className="text-[var(--ink)] font-display tracking-[-0.005em] group-hover:text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]">{p.name_cn}</span>
                      <span className="ml-2 text-[var(--ink-mute)]">{p.name_en}</span>
                    </Link>
                    <span className="ml-2 text-[11px] text-[var(--ink-faint)]">{p.abbrev}</span>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/programmes/${p.id}`}
                      className="text-[12.5px] underline underline-offset-2 rounded-sm focus-visible:shadow-[var(--shadow-focus)]"
                      style={{ color: "var(--cinnabar)" }}
                    >
                      {courseCounts.get(p.id) ?? 0} course{courseCounts.get(p.id) === 1 ? "" : "s"}
                    </Link>
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

      {admin.role === "super_admin" ? (
        <section className="mt-10">
          <h2 className="font-display text-[22px] tracking-[-0.01em] text-[var(--ink)]">
            Course history check <span className="text-[15px] text-[var(--ink-mute)]">· 曾参加课程核对</span>
          </h2>
          <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[75ch]">
            复训 prices go to people who checked in at an earlier run of the course, or whose course history has that
            course <em>picked from the course list</em>. Entries typed in by hand don&apos;t count, so nobody gets a 复训
            price on a guess. Fix the entries below by opening the person and picking the course.
          </p>
          {unlinked.length === 0 ? (
            <p className="mt-4 text-[13px] text-[#3a6b3b]">✓ Every course-history entry is linked to the course list.</p>
          ) : (
            <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] overflow-hidden">
              <div className="px-5 py-3 text-[12.5px] text-[#B45309] border-b border-[var(--paper-shadow)]">
                {unlinkedEntries} entr{unlinkedEntries === 1 ? "y" : "ies"} for {unlinked.length} participant
                {unlinked.length === 1 ? "" : "s"} won&apos;t count for 复训 pricing.
              </div>
              <ul>
                {unlinked.map((u) => (
                  <li key={u.participant_id} className="px-5 py-3 border-t first:border-t-0 border-[var(--paper-shadow)]/70 flex items-start gap-4 flex-wrap">
                    <Link
                      href={`/admin/participants/${u.participant_id}`}
                      className="min-w-[180px] text-[13.5px] text-[var(--ink)] hover:text-[var(--cinnabar-deep)] rounded-sm focus-visible:shadow-[var(--shadow-focus)]"
                    >
                      {u.name}
                      {u.region_id ? <span className="ml-2 font-mono text-[11.5px] text-[var(--ink-mute)]">{u.region_id}</span> : null}
                    </Link>
                    <div className="flex-1 flex flex-wrap gap-1.5">
                      {u.entries.map((e, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-[var(--paper-shadow)] px-2.5 py-0.5 text-[11.5px] text-[var(--ink-soft)]"
                          title={e.problem === "course_missing" ? "Linked course was deleted" : "Typed in, not linked"}
                        >
                          {e.course_name}
                          {e.date ? ` · ${e.date}` : ""}
                          <span className="ml-1 text-[#B45309]">{e.problem === "course_missing" ? "course deleted" : "not linked"}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
