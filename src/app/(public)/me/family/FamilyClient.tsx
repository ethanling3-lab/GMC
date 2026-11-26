"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChildRow } from "@/lib/participants/children";

type Form = { name_cn: string; name_en: string; birth_date: string; gender: string };
const EMPTY: Form = { name_cn: "", name_en: "", birth_date: "", gender: "" };

const field =
  "h-10 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const label = "text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

const GENDER: Record<string, string> = { male: "Male · 男", female: "Female · 女" };

export function FamilyClient({ initial }: { initial: ChildRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(initial.length === 0 ? "new" : null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function start(c: ChildRow | null) {
    setMsg(null);
    setEditing(c ? c.id : "new");
    setForm(c ? { name_cn: c.name_cn ?? "", name_en: c.name_en ?? "", birth_date: c.birth_date ?? "", gender: c.gender ?? "" } : EMPTY);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/me/children" : `/api/me/children/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name_cn: form.name_cn, name_en: form.name_en || null, birth_date: form.birth_date, gender: form.gender || null }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string; created?: boolean };
      if (!res.ok) throw new Error(j.detail ?? "Could not save.");
      setMsg({
        ok: true,
        text: isNew ? (j.created === false ? `${form.name_cn} is already on your list.` : `✓ Added ${form.name_cn}.`) : "✓ Saved.",
      });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  const formBox = (
    <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="flex flex-col gap-1">
        <span className={label}>Chinese name · 中文名</span>
        <input className={field} value={form.name_cn} onChange={(e) => setForm({ ...form, name_cn: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>English name · 英文名 (optional)</span>
        <input className={field} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Birth date · 出生日期</span>
        <input type="date" className={field} max={new Date().toISOString().slice(0, 10)} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Gender · 性别</span>
        <select className={field} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
          <option value="">—</option>
          <option value="male">Male · 男</option>
          <option value="female">Female · 女</option>
        </select>
      </label>
      <div className="sm:col-span-2 flex justify-end gap-2">
        {initial.length > 0 || editing !== "new" ? (
          <button type="button" onClick={() => setEditing(null)} className="h-9 px-4 rounded-full border border-[var(--paper-shadow)] text-[12.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,transform]">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={saving || !form.name_cn.trim() || !form.birth_date}
          className="h-9 px-4 rounded-full bg-[var(--cinnabar)] text-[12.5px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 active:scale-[0.98] transition-[background-color,transform]"
          style={{ color: "var(--paper-warm)" }}
        >
          {saving ? "Saving…" : editing === "new" ? "Add child · 添加" : "Save · 保存"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
      {initial.length > 0 ? (
        <ul className="divide-y divide-[var(--paper-shadow)]">
          {initial.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] text-[var(--ink)]">
                    {c.name_cn}
                    {c.name_en ? <span className="ml-2 text-[13px] text-[var(--ink-soft)]">{c.name_en}</span> : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--ink-mute)] tabular-nums">
                    {[c.birth_date, c.gender ? GENDER[c.gender] ?? c.gender : null, c.region_id].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {editing !== c.id ? (
                  <button type="button" onClick={() => start(c)} className="h-8 px-3 rounded-full border border-[var(--paper-shadow)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,color,transform]">
                    Edit
                  </button>
                ) : null}
              </div>
              {editing === c.id ? formBox : null}
            </li>
          ))}
        </ul>
      ) : null}

      {editing === "new" ? formBox : (
        <button
          type="button"
          onClick={() => start(null)}
          className="mt-3 text-[13px] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] focus-visible:underline"
          style={{ color: "var(--cinnabar-deep)" }}
        >
          + Add a child · 添加子女
        </button>
      )}

      {msg ? <p className={`mt-3 text-[12.5px] ${msg.ok ? "text-[var(--ink-soft)]" : "text-[var(--cinnabar-deep)]"}`}>{msg.text}</p> : null}
    </section>
  );
}
