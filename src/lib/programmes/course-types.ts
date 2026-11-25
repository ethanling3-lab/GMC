// Client-safe shapes for programme course lists (migration 079).
// Course names are shared: one `courses` row can be in several programmes.

export type Course = {
  id: string;
  name_cn: string;
  name_en: string | null;
  subtitle_cn: string | null;
  subtitle_en: string | null;
  active: boolean;
};

/** One course as listed under a programme. */
export type ProgrammeCourse = {
  link_id: string;
  section_cn: string;
  section_en: string;
  sort_order: number;
  course: Course;
  /** Runs (events) of this course, from any programme. */
  runs: CourseRuns;
  /** Other programmes that also include this course. */
  also_in: Array<{ id: string; name_cn: string }>;
};

/** A course's runs: the next upcoming one, and how many lie ahead / behind. */
export type CourseRuns = {
  next: { id: string; start_date: string; title: string } | null;
  upcoming: number;
  past: number;
};

/** Course choice in the event editor / plan form. */
export type CourseOption = {
  id: string;
  name_cn: string;
  name_en: string | null;
  /** Programmes that include it, e.g. ["丰盛", "荣贵"]. */
  programmes: string[];
};

export function courseLabel(c: { name_cn: string; name_en: string | null }): string {
  return c.name_en ? `${c.name_cn} · ${c.name_en}` : c.name_cn;
}

/** Group a programme's list into its sections (by Chinese name), in the
 *  order each section first appears. One box per section, always. */
export function groupBySection(list: ProgrammeCourse[]): Array<{ section_cn: string; section_en: string; items: ProgrammeCourse[] }> {
  const out: Array<{ section_cn: string; section_en: string; items: ProgrammeCourse[] }> = [];
  const byKey = new Map<string, (typeof out)[number]>();
  for (const pc of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
    const g = byKey.get(pc.section_cn);
    if (g) g.items.push(pc);
    else {
      const ng = { section_cn: pc.section_cn, section_en: pc.section_en, items: [pc] };
      byKey.set(pc.section_cn, ng);
      out.push(ng);
    }
  }
  return out;
}
