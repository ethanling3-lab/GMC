"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type TemplateOption = { id: string; name_en: string | null; name_cn: string | null };

export function EventGroupReportsClient({
  eventId,
  templates,
  currentTemplateId,
}: {
  eventId: string;
  templates: TemplateOption[];
  currentTemplateId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentTemplateId ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onChange(next: string) {
    setValue(next);
    setBusy(true);
    setSaved(false);
    try {
      await fetch(`/api/admin/events/${eventId}/group-report-template`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: next || null }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        className="px-3 h-10 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]"
      >
        <option value="">— No group report (off) —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name_cn ?? t.name_en ?? "(untitled)"}
          </option>
        ))}
      </select>
      {saved ? <span className="text-[12px] text-[#3a6b3b]">✓ Saved</span> : null}
      {templates.length === 0 ? (
        <Link href="/admin/group-reports" className="text-[12px] text-[var(--cinnabar-deep)] hover:underline">
          Build a template first →
        </Link>
      ) : null}
    </div>
  );
}

export function ExportAllButton({ eventId, disabled }: { eventId: string; disabled: boolean }) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-faint)] cursor-not-allowed">
        Export all · XLSX
      </span>
    );
  }
  return (
    <a
      href={`/api/admin/events/${eventId}/group-reports/export.xlsx`}
      className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px transition-[background-color,transform] duration-[var(--dur-fast)]"
      style={{ color: "var(--paper-warm)" }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13.5h10" />
      </svg>
      Export all · XLSX
    </a>
  );
}
