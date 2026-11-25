import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { listCourses } from "@/lib/courses/courses";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const metadata: Metadata = { title: "Courses" };
export const dynamic = "force-dynamic";

// Course catalogue (migration 075) — Super Admin only. Each event is a
// dated session of one of these.
export default async function CoursesPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin");
  const courses = await listCourses({ includeInactive: true });

  const service = createSupabaseServiceClient();
  const { data: rows } = await service
    .from("events")
    .select("course_id")
    .not("course_id", "is", null)
    .returns<Array<{ course_id: string }>>();
  const sessions = new Map<string, number>();
  for (const r of rows ?? []) sessions.set(r.course_id, (sessions.get(r.course_id) ?? 0) + 1);

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Catalogue · 课程目录
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Courses.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            The kinds of class GMC runs. Every event on the calendar is a dated session of one
            course, coloured by it. Programme packages will list which courses they include.
          </p>
        </div>
        <Link
          href="/admin/courses/new"
          className="inline-flex items-center h-10 px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,transform] duration-[var(--dur-fast)]"
          style={{ color: "var(--paper-warm)" }}
        >
          New course
        </Link>
      </div>

      <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] border-b border-[var(--paper-shadow)]">
              <th className="px-5 py-3 font-normal">Course</th>
              <th className="px-3 py-3 font-normal">Short label</th>
              <th className="px-3 py-3 font-normal text-right">Sessions</th>
              <th className="px-3 py-3 font-normal">Status</th>
              <th className="px-5 py-3 font-normal" />
            </tr>
          </thead>
          <tbody>
            {courses.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[var(--ink-mute)]">
                  No courses yet. Add the first one — e.g. 永不落空 · The Infallible Power — then link events to it.
                </td>
              </tr>
            ) : (
              courses.map((c) => (
                <tr key={c.id} className="border-t border-[var(--paper-shadow)] even:bg-[var(--paper-deep)]/30">
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: c.colour }} aria-hidden="true" />
                      <span className="text-[var(--ink)] font-display tracking-[-0.005em]">{c.name_cn}</span>
                      <span className="text-[var(--ink-mute)]">{c.name_en}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[var(--ink-soft)]">{c.short_label}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--ink-soft)]">{sessions.get(c.id) ?? 0}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[11px] tracking-[0.1em] uppercase ${c.active ? "text-[var(--jade-deep)]" : "text-[var(--ink-faint)]"}`}>
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/courses/${c.id}/edit`}
                      className="text-[12px] tracking-[0.04em] uppercase hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)]"
                      style={{ color: "var(--cinnabar)" }}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
