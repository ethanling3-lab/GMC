"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type TemplateRow = {
  id: string;
  name_en: string | null;
  name_cn: string | null;
  active: boolean;
  updated_at: string;
};

export function TemplateListClient({ initial }: { initial: TemplateRow[] }) {
  const router = useRouter();
  const [nameCn, setNameCn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!nameEn.trim() && !nameCn.trim()) {
      setError("Name the template (EN or 中文).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/group-report-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name_en: nameEn.trim() || undefined, name_cn: nameCn.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.id) throw new Error(json?.detail ?? "Could not create");
      router.push(`/admin/group-reports/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  async function toggleActive(t: TemplateRow) {
    await fetch(`/api/admin/group-report-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    router.refresh();
  }

  async function remove(t: TemplateRow) {
    if (!confirm("Delete this template? Events using it will lose it.\n删除此模板？")) return;
    await fetch(`/api/admin/group-report-templates/${t.id}`, { method: "DELETE" });
    router.refresh();
  }

  const inputCls =
    "w-full px-3 h-10 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  return (
    <>
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          New · 新建
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={nameCn} onChange={(e) => setNameCn(e.target.value)} placeholder="模板名称 (中文)" className={inputCls} maxLength={200} />
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Template name (English)" className={inputCls} maxLength={200} />
        </div>
        {error ? <div className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</div> : null}
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
          style={{ color: "var(--paper-warm)" }}
        >
          {busy ? "Creating…" : "Create + edit · 创建"}
        </button>
      </section>

      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Templates · 模板库
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">{initial.length} total</span>
        </div>
        {initial.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-mute)]">No templates yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--paper-shadow)]">
            {initial.map((t) => {
              const name = t.name_cn ?? t.name_en ?? "(untitled)";
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 py-3">
                  <Link href={`/admin/group-reports/${t.id}`} className="min-w-0 flex-1" style={{ color: "inherit" }}>
                    <span className="text-[14px] text-[var(--ink)] hover:text-[var(--cinnabar-deep)]">{name}</span>
                    {!t.active ? (
                      <span className="ml-2 text-[9.5px] tracking-[0.14em] uppercase px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-faint)]">Inactive</span>
                    ) : null}
                  </Link>
                  <div className="flex-none flex items-center gap-3 text-[11px] tracking-[0.1em] uppercase">
                    <button type="button" onClick={() => toggleActive(t)} className="text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)]">
                      {t.active ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" onClick={() => remove(t)} className="text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)]">Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
