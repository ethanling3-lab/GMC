"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminAssignmentRow = {
  id: string;
  title_en: string | null;
  title_cn: string | null;
  kind: "homework" | "report";
  submission_type: "file" | "text" | "both";
  due_at: string | null;
  active: boolean;
  created_at: string;
  submitted_count: number;
  draft_count: number;
};

const KIND_LABEL: Record<AdminAssignmentRow["kind"], string> = {
  homework: "Homework · 作业",
  report: "Report · 报告",
};
const TYPE_LABEL: Record<AdminAssignmentRow["submission_type"], string> = {
  both: "Text + files",
  text: "Text only",
  file: "Files only",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AssignmentManager({
  eventId,
  initial,
}: {
  eventId: string;
  initial: AdminAssignmentRow[];
}) {
  const router = useRouter();
  const [titleCn, setTitleCn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [descCn, setDescCn] = useState("");
  const [kind, setKind] = useState<AdminAssignmentRow["kind"]>("homework");
  const [subType, setSubType] = useState<AdminAssignmentRow["submission_type"]>("both");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!titleEn.trim() && !titleCn.trim()) {
      setError("Add a title (EN or 中文)");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title_en: titleEn.trim() || undefined,
          title_cn: titleCn.trim() || undefined,
          description_cn: descCn.trim() || undefined,
          kind,
          submission_type: subType,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.detail ?? "Could not create");
      setTitleCn("");
      setTitleEn("");
      setDescCn("");
      setDueAt("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: AdminAssignmentRow) {
    await fetch(`/api/admin/events/${eventId}/assignments/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !a.active }),
    });
    router.refresh();
  }

  async function remove(a: AdminAssignmentRow) {
    if (!confirm(`Delete this assignment? Submissions will be hidden.\n删除此作业？`)) return;
    await fetch(`/api/admin/events/${eventId}/assignments/${a.id}`, { method: "DELETE" });
    router.refresh();
  }

  const fieldClass =
    "mt-1.5 w-full px-3 h-10 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
  const labelClass = "text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]";

  return (
    <>
      {/* Create */}
      <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          New · 新建
        </div>
        <h2 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
          Create an assignment
        </h2>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelClass}>Title · 标题 (中文)</span>
            <input value={titleCn} onChange={(e) => setTitleCn(e.target.value)} placeholder="例：第一天作业" className={fieldClass} maxLength={200} />
          </label>
          <label className="block">
            <span className={labelClass}>Title · Title (English)</span>
            <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="e.g. Day 1 homework" className={fieldClass} maxLength={200} />
          </label>
        </div>

        <label className="block mt-4">
          <span className={labelClass}>Instructions · 说明 (optional)</span>
          <textarea
            value={descCn}
            onChange={(e) => setDescCn(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What should learners submit?"
            className="mt-1.5 w-full px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[14px] leading-[1.6] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] resize-y"
          />
        </label>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className={labelClass}>Type · 类型</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as AdminAssignmentRow["kind"])} className={fieldClass}>
              <option value="homework">Homework · 作业</option>
              <option value="report">Report · 报告</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Submission · 提交方式</span>
            <select value={subType} onChange={(e) => setSubType(e.target.value as AdminAssignmentRow["submission_type"])} className={fieldClass}>
              <option value="both">Text + files</option>
              <option value="text">Text only</option>
              <option value="file">Files only</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Due · 截止 (optional)</span>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={fieldClass} />
          </label>
        </div>

        {error ? (
          <div role="alert" className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
          style={{ color: "var(--paper-warm)" }}
        >
          {busy ? "Creating…" : "Create assignment · 创建"}
        </button>
      </section>

      {/* List */}
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Assignments · 作业库
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">{initial.length} total</span>
        </div>

        {initial.length === 0 ? (
          <p className="text-[13px] leading-[1.7] text-[var(--ink-mute)]">No assignments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Title</th>
                  <th className="pb-3 font-normal">Submission</th>
                  <th className="pb-3 font-normal">Due</th>
                  <th className="pb-3 font-normal">Submitted</th>
                  <th className="pb-3 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {initial.map((a) => {
                  const t = a.title_cn ?? a.title_en ?? "—";
                  return (
                    <tr key={a.id} className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/40 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Link href={`/admin/events/${eventId}/assignments/${a.id}`} className="text-[var(--ink)] hover:text-[var(--cinnabar-deep)] truncate max-w-[260px]" style={{ color: "inherit" }}>
                            {t}
                          </Link>
                          {!a.active ? (
                            <span className="text-[9.5px] tracking-[0.14em] uppercase px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-faint)]">Hidden</span>
                          ) : null}
                        </div>
                        <div className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] mt-0.5">{KIND_LABEL[a.kind]}</div>
                      </td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)]">{TYPE_LABEL[a.submission_type]}</td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">{fmtWhen(a.due_at)}</td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">
                        <Link href={`/admin/events/${eventId}/assignments/${a.id}`} className="hover:text-[var(--cinnabar-deep)]" style={{ color: "inherit" }}>
                          {a.submitted_count}
                          {a.draft_count > 0 ? <span className="text-[var(--ink-faint)]"> (+{a.draft_count} draft)</span> : null}
                        </Link>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => toggleActive(a)} className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] mr-3">
                          {a.active ? "Hide" : "Show"}
                        </button>
                        <button type="button" onClick={() => remove(a)} className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)]">
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
