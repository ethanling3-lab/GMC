"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Pencil-triggered edit for a single entry inside a row's manual_passengers
// JSONB array. Loads the full array, swaps the targeted index, PATCHes the
// whole array back. The row PATCH route trims/normalizes per entry.

export type ManualPassengerEntry = {
  name: string;
  region_id?: string | null;
  note?: string | null;
};

export function EditManualPassengerDialog({
  listId,
  rowId,
  index,
  passengers,
}: {
  listId: string;
  rowId: string;
  index: number;
  passengers: ManualPassengerEntry[];
}) {
  const router = useRouter();
  const initial = passengers[index] ?? { name: "" };

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name ?? "");
  const [regionId, setRegionId] = useState(initial.region_id ?? "");
  const [note, setNote] = useState(initial.note ?? "");

  useEffect(() => {
    if (!open) {
      setName(initial.name ?? "");
      setRegionId(initial.region_id ?? "");
      setNote(initial.note ?? "");
      setError(null);
      setBusy(false);
    }
  }, [open, initial.name, initial.region_id, initial.note]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next: ManualPassengerEntry[] = passengers.map((p, i) =>
        i === index
          ? {
              name: trimmedName,
              ...(regionId.trim() ? { region_id: regionId.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            }
          : p,
      );
      const res = await fetch(
        `/api/admin/transfer-lists/${listId}/rows/${rowId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ manual_passengers: next }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Save failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit passenger"
        aria-label="Edit passenger"
        className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
      >
        <span aria-hidden="true" className="text-[11px] leading-none">✎</span>
      </button>

      {!open ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-pax-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[420px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Edit passenger · 修改乘客
              </div>
              <h2
                id="edit-pax-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                Manual passenger
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                These passengers live on this transfer row only — not in the
                participant CRM.
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className={inputClass}
                  autoFocus
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Region ID (optional)">
                  <input
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value.toUpperCase())}
                    placeholder="MY101"
                    className={`${inputClass} uppercase tabular-nums`}
                  />
                </Field>
                <Field label="Note (optional)">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. dietary"
                    className={inputClass}
                  />
                </Field>
              </div>
              {error ? (
                <div className="text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>
            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputClass =
  "w-full h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none transition-[border-color,box-shadow]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
