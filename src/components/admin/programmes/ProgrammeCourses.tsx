"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { groupBySection, type Course, type ProgrammeCourse } from "@/lib/programmes/course-types";

// "Included courses · 包含课程" on a programme's page. Everyone who can
// open the page reads it; Super Admin adds, renames, moves and removes.
// Course names are shared across programmes, so a rename shows everywhere.

const input =
  "h-9 w-full px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const smallBtn =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-40 transition-[border-color,color,transform] duration-[var(--dur-fast)]";
const primaryBtn =
  "inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";
const label = "text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

type Draft = { name_cn: string; name_en: string; subtitle_cn: string; subtitle_en: string; section_cn: string; section_en: string };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
  if (!res.ok) throw new Error(j.detail ?? j.error ?? `Failed (${res.status})`);
}

export function ProgrammeCourses({
  programmeId,
  programmeName,
  items,
  allCourses,
  canEdit,
  canPlan,
  planYear,
}: {
  programmeId: string;
  programmeName: string;
  items: ProgrammeCourse[];
  allCourses: Course[];
  canEdit: boolean;
  /** Super Admin: may plan runs on the calendar. */
  canPlan: boolean;
  /** Calendar year "+ Plan a run" opens on. */
  planYear: number;
}) {
  const router = useRouter();
  const sections = useMemo(() => groupBySection(items), [items]);
  const sectionChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sections) if (s.section_cn) seen.set(s.section_cn, s.section_en);
    return [...seen.entries()];
  }, [sections]);
  const inProgramme = useMemo(() => new Set(items.map((i) => i.course.id)), [items]);

  const [editing, setEditing] = useState<{ linkId: string; d: Draft } | null>(null);
  const [adding, setAdding] = useState<Draft>({
    name_cn: "",
    name_en: "",
    subtitle_cn: "",
    subtitle_en: "",
    section_cn: sectionChoices[0]?.[0] ?? "",
    section_en: sectionChoices[0]?.[1] ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const existing = allCourses.find((c) => c.name_cn === adding.name_cn.trim());

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      const msg = await fn();
      setNotice({ ok: true, text: msg });
      router.refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/admin/programmes/${programmeId}/courses`;

  const add = () =>
    run(async () => {
      await call(base, "POST", {
        course_id: existing?.id,
        name_cn: adding.name_cn,
        name_en: adding.name_en || null,
        subtitle_cn: adding.subtitle_cn || null,
        subtitle_en: adding.subtitle_en || null,
        section_cn: adding.section_cn,
        section_en: adding.section_en,
      });
      const name = adding.name_cn.trim();
      setAdding((a) => ({ ...a, name_cn: "", name_en: "", subtitle_cn: "", subtitle_en: "" }));
      return `✓ Added ${name} to ${programmeName}.`;
    });

  const save = () =>
    editing &&
    run(async () => {
      const { d } = editing;
      await call(`${base}/${editing.linkId}`, "PATCH", {
        section_cn: d.section_cn,
        section_en: d.section_en,
        names: { name_cn: d.name_cn, name_en: d.name_en || null, subtitle_cn: d.subtitle_cn || null, subtitle_en: d.subtitle_en || null },
      });
      setEditing(null);
      return "✓ Course updated.";
    });

  const move = (linkId: string, dir: "up" | "down") => run(async () => (await call(`${base}/${linkId}`, "PATCH", { move: dir }), "✓ Moved."));

  const remove = (pc: ProgrammeCourse) => {
    if (!window.confirm(`Remove ${pc.course.name_cn} from ${programmeName}? The course stays in any other programmes and events.`)) return;
    void run(async () => (await call(`${base}/${pc.link_id}`, "DELETE"), `✓ Removed ${pc.course.name_cn} from ${programmeName}.`));
  };


  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="font-display text-[24px] tracking-[-0.01em] text-[var(--ink)]">
          Included courses <span className="text-[16px] text-[var(--ink-mute)]">· 包含课程</span>
        </h2>
        <span className="text-[12px] text-[var(--ink-mute)]">
          {items.length} course{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {canEdit ? (
        <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5">
          <h3 className="text-[14px] font-medium text-[var(--ink)]">Add a course · 添加课程</h3>
          <p className="mt-1 text-[12px] text-[var(--ink-mute)]">
            Type a course name. If another programme already has it, pick it from the list so both share it.
          </p>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <SectionPicker
              choices={sectionChoices}
              cn={adding.section_cn}
              en={adding.section_en}
              onChange={(cn, en) => setAdding((a) => ({ ...a, section_cn: cn, section_en: en }))}
            />
            <label className="flex flex-col gap-1">
              <span className={label}>Course (CN) · 中文名称</span>
              <CourseCombo
                value={adding.name_cn}
                courses={allCourses}
                inProgramme={inProgramme}
                programmeName={programmeName}
                onChange={(v) => setAdding((a) => ({ ...a, name_cn: v }))}
              />
            </label>
            {existing && inProgramme.has(existing.id) ? (
              <div className="flex items-end pb-2 text-[12px] text-[var(--cinnabar-deep)]">
                Already in {programmeName}.
              </div>
            ) : existing ? (
              <div className="flex items-end pb-2 text-[12px] text-[var(--ink-soft)]">
                Existing course{existing.name_en ? ` · ${existing.name_en}` : ""}: it will be shared with the programmes that already list it.
              </div>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={label}>Course (EN)</span>
                <input className={input} value={adding.name_en} placeholder="Infallible Power" onChange={(e) => setAdding((a) => ({ ...a, name_en: e.target.value }))} />
              </label>
            )}
            {!existing ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className={label}>Subtitle (CN) · 副标题 — optional</span>
                  <input className={input} value={adding.subtitle_cn} onChange={(e) => setAdding((a) => ({ ...a, subtitle_cn: e.target.value }))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Subtitle (EN) — optional</span>
                  <input className={input} value={adding.subtitle_en} onChange={(e) => setAdding((a) => ({ ...a, subtitle_en: e.target.value }))} />
                </label>
              </>
            ) : null}
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className={primaryBtn} style={{ color: "var(--paper-warm)" }} disabled={busy || !adding.name_cn.trim() || !adding.section_cn.trim() || (!!existing && inProgramme.has(existing.id))} onClick={add}>
              + Add course
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={`mt-3 text-[12.5px] ${notice.ok ? "text-[var(--ink-soft)]" : "text-[var(--cinnabar-deep)]"}`}>{notice.text}</p>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-5 rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] px-6 py-10 text-center text-[13px] text-[var(--ink-mute)]">
          No courses listed for this programme yet.{canEdit ? " Add them below, section by section, as in the brochure." : ""}
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          {sections.map((sec) => (
            <div
              key={`${sec.section_cn}|${sec.section_en}`}
              className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--paper-deep)]/40">
                <span className="text-[14px] text-[var(--ink)] font-medium">{sec.section_cn || "—"}</span>
                {sec.section_en ? <span className="ml-2 text-[12px] text-[var(--ink-mute)]">{sec.section_en}</span> : null}
              </div>
              <ul>
                {sec.items.map((pc, idx) => {
                  if (editing?.linkId === pc.link_id) {
                    const d = editing.d;
                    const set = (k: keyof Draft, v: string) => setEditing({ linkId: pc.link_id, d: { ...d, [k]: v } });
                    return (
                      <li key={pc.link_id} className="px-5 py-4 border-t first:border-t-0 border-[var(--paper-shadow)]/70 bg-[var(--paper)]/60">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1"><span className={label}>Course (CN) · 中文名称</span><input className={input} value={d.name_cn} onChange={(e) => set("name_cn", e.target.value)} /></label>
                          <label className="flex flex-col gap-1"><span className={label}>Course (EN)</span><input className={input} value={d.name_en} onChange={(e) => set("name_en", e.target.value)} /></label>
                          <label className="flex flex-col gap-1"><span className={label}>Subtitle (CN) · 副标题</span><input className={input} value={d.subtitle_cn} onChange={(e) => set("subtitle_cn", e.target.value)} /></label>
                          <label className="flex flex-col gap-1"><span className={label}>Subtitle (EN)</span><input className={input} value={d.subtitle_en} onChange={(e) => set("subtitle_en", e.target.value)} /></label>
                          <SectionPicker
                            choices={sectionChoices}
                            cn={d.section_cn}
                            en={d.section_en}
                            onChange={(cn, en) => setEditing({ linkId: pc.link_id, d: { ...d, section_cn: cn, section_en: en } })}
                          />
                        </div>
                        {pc.also_in.length > 0 ? (
                          <p className="mt-2 text-[11.5px] text-[var(--ink-mute)]">
                            Renaming also changes it in {pc.also_in.map((p) => p.name_cn).join(" · ")}. The section only changes here.
                          </p>
                        ) : null}
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" className={smallBtn} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                          <button type="button" className={primaryBtn} style={{ color: "var(--paper-warm)" }} disabled={busy || !d.name_cn.trim()} onClick={save}>Save</button>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={pc.link_id} className="px-5 py-3.5 border-t first:border-t-0 border-[var(--paper-shadow)]/70 flex items-start gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] text-[var(--ink)] font-display tracking-[-0.005em]">
                          {pc.course.name_cn}
                          {pc.course.name_en ? <span className="ml-2 font-body text-[13px] text-[var(--ink-soft)]">{pc.course.name_en}</span> : null}
                        </div>
                        {pc.course.subtitle_cn || pc.course.subtitle_en ? (
                          <div className="mt-0.5 text-[12px] text-[var(--ink-mute)]">
                            {[pc.course.subtitle_cn, pc.course.subtitle_en].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                        {pc.also_in.length > 0 ? (
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--ink-faint)]">
                            Also in
                            {pc.also_in.map((p) => (
                              <Link
                                key={p.id}
                                href={`/admin/programmes/${p.id}`}
                                className="rounded-full border border-[var(--paper-shadow)] px-2 py-px text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/40 focus-visible:shadow-[var(--shadow-focus)] transition-colors duration-[var(--dur-fast)]"
                              >
                                {p.name_cn}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 flex-none">
                        <RunsSummary pc={pc} />
                        {canPlan ? (
                          <Link
                            href={`/admin/calendar?view=year&year=${planYear}&plan=${pc.course.id}`}
                            className={smallBtn}
                          >
                            + Plan a run
                          </Link>
                        ) : null}
                        {canEdit ? (
                          <>
                            <button type="button" aria-label="Move up" className={smallBtn} disabled={busy || idx <= 0} onClick={() => move(pc.link_id, "up")}>↑</button>
                            <button type="button" aria-label="Move down" className={smallBtn} disabled={busy || idx >= sec.items.length - 1} onClick={() => move(pc.link_id, "down")}>↓</button>
                            <button
                              type="button"
                              className={smallBtn}
                              disabled={busy}
                              onClick={() =>
                                setEditing({
                                  linkId: pc.link_id,
                                  d: {
                                    name_cn: pc.course.name_cn,
                                    name_en: pc.course.name_en ?? "",
                                    subtitle_cn: pc.course.subtitle_cn ?? "",
                                    subtitle_en: pc.course.subtitle_en ?? "",
                                    section_cn: pc.section_cn,
                                    section_en: pc.section_en,
                                  },
                                })
                              }
                            >
                              Edit
                            </button>
                            <button type="button" className={smallBtn} disabled={busy} onClick={() => remove(pc)}>Remove</button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const NEW_SECTION = "__new__";

/** Pick one of the programme's sections, or type a new one (CN + EN). */
function SectionPicker({
  choices,
  cn,
  en,
  onChange,
}: {
  choices: Array<[string, string]>;
  cn: string;
  en: string;
  onChange: (cn: string, en: string) => void;
}) {
  const [isNew, setIsNew] = useState(() => choices.length === 0 || !choices.some(([c]) => c === cn));
  return (
    <>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className={label}>Section · 类别</span>
        <select
          className={input}
          value={isNew ? NEW_SECTION : cn}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_SECTION) {
              setIsNew(true);
              onChange("", "");
            } else {
              setIsNew(false);
              onChange(v, choices.find(([c]) => c === v)?.[1] ?? "");
            }
          }}
        >
          {choices.map(([c, e]) => (
            <option key={c} value={c}>
              {e ? `${c} · ${e}` : c}
            </option>
          ))}
          <option value={NEW_SECTION}>+ New section · 新类别…</option>
        </select>
      </label>
      {isNew ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={label}>New section (CN) · 类别名称</span>
            <input className={input} value={cn} placeholder="必修课" onChange={(e) => onChange(e.target.value, en)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>New section (EN)</span>
            <input className={input} value={en} placeholder="Compulsory Courses" onChange={(e) => onChange(cn, e.target.value)} />
          </label>
        </>
      ) : null}
    </>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Next run 12 Mar 2027 · 3 past" — each part opens the matching events. */
function RunsSummary({ pc }: { pc: ProgrammeCourse }) {
  const { next, upcoming, past } = pc.runs;
  const linkCls = "underline underline-offset-2 rounded-sm focus-visible:shadow-[var(--shadow-focus)]";
  if (!next && past === 0) return <span className="text-[12px] text-[var(--ink-faint)]">No runs planned</span>;
  return (
    <span className="text-[12px] text-[var(--ink-soft)] text-right">
      {next ? (
        <>
          Next run{" "}
          <Link href={`/admin/events/${next.id}`} className={linkCls} style={{ color: "var(--cinnabar)" }}>
            {shortDate(next.start_date)}
          </Link>
          {upcoming > 1 ? (
            <>
              {" "}
              <Link href={`/admin/events?course=${pc.course.id}&archived=all`} className={`${linkCls} text-[var(--ink-mute)]`}>
                +{upcoming - 1} more
              </Link>
            </>
          ) : null}
        </>
      ) : (
        <span className="text-[var(--ink-faint)]">No upcoming run</span>
      )}
      {past > 0 ? (
        <>
          {" · "}
          <Link href={`/admin/events?course=${pc.course.id}&archived=all`} className={linkCls} style={{ color: "var(--cinnabar)" }}>
            {past} past
          </Link>
        </>
      ) : null}
    </span>
  );
}

/** Course name box with a compact list of every course. Courses already in
 *  this programme are shown greyed so a new one is visible straight away. */
function CourseCombo({
  value,
  courses,
  inProgramme,
  programmeName,
  onChange,
}: {
  value: string;
  courses: Course[];
  inProgramme: Set<string>;
  programmeName: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const q = value.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = q
      ? courses.filter((c) => c.name_cn.toLowerCase().includes(q) || (c.name_en ?? "").toLowerCase().includes(q))
      : courses;
    // Pickable first, then the ones already here.
    return [...list].sort((a, b) => Number(inProgramme.has(a.id)) - Number(inProgramme.has(b.id)));
  }, [courses, inProgramme, q]);

  function pick(c: Course) {
    if (inProgramme.has(c.id)) return;
    onChange(c.name_cn);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const n = Math.max(0, Math.min(shown.length - 1, i + step));
        listRef.current?.children[n]?.scrollIntoView({ block: "nearest" });
        return n;
      });
    } else if (e.key === "Enter" && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        className={input}
        value={value}
        placeholder="永不落空的力量"
        role="combobox"
        aria-expanded={open}
        aria-controls="course-combo-list"
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {open && shown.length > 0 ? (
        <ul
          id="course-combo-list"
          ref={listRef}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] py-1 shadow-[var(--shadow-paper-2)]"
        >
          {shown.map((c, i) => {
            const here = inProgramme.has(c.id);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={here}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={`px-2.5 py-1.5 text-[12.5px] leading-snug ${
                  here
                    ? "cursor-default text-[var(--ink-faint)]"
                    : `cursor-pointer text-[var(--ink)] ${i === active ? "bg-[var(--paper-warm)]" : ""}`
                }`}
              >
                <span>{c.name_cn}</span>
                {c.name_en ? <span className="ml-1.5 text-[11.5px] text-[var(--ink-mute)]">{c.name_en}</span> : null}
                {here ? <span className="ml-1.5 text-[11px]">· already in {programmeName}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
