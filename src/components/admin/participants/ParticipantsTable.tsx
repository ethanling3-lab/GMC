"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantStatus } from "@/lib/participants-query";

export type ParticipantRow = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  region: string | null;
  email: string | null;
  status: ParticipantStatus;
  overall_score: number | null;
  motivation_tag: string | null;
  archived_at: string | null;
  created_at: string;
};

export type CsAdmin = {
  id: string;
  name_en: string | null;
  name_cn: string | null;
  role: string;
};

type Props = {
  rows: ParticipantRow[];
  adminRole: string;
  hasFilters: boolean;
  customerService: CsAdmin[];
};

const STATUS_LABEL: Record<ParticipantStatus, string> = {
  new: "New",
  info_verified: "Info Verified",
  cs_enriched: "CS Enriched",
  active: "Active",
  inactive: "Inactive",
  lead: "Lead",
};

const STATUS_ZH: Record<ParticipantStatus, string> = {
  new: "新",
  info_verified: "信息已核",
  cs_enriched: "资料完善",
  active: "活跃",
  inactive: "停用",
  lead: "潜在",
};

const STATUS_TONE: Record<
  ParticipantStatus,
  { dot: string; bg: string; ring: string; text: string }
> = {
  new: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/25",
    text: "text-[var(--cinnabar-deep)]",
  },
  info_verified: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/25",
    text: "text-[var(--jade-deep)]",
  },
  cs_enriched: {
    dot: "bg-[var(--cinnabar-soft)]",
    bg: "bg-[var(--gold-soft)]",
    ring: "border-[var(--cinnabar-soft)]/35",
    text: "text-[var(--cinnabar-deep)]",
  },
  active: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
  inactive: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
  lead: {
    dot: "bg-[var(--gold)]",
    bg: "bg-[var(--gold-soft)]",
    ring: "border-[var(--gold)]/40",
    text: "text-[var(--ink)]",
  },
};

// Bulk-action menu shows only statuses an admin can manually pick. `lead` is
// system-created from the inbox ingest and should only transition out via
// explicit "Merge with existing participant" flow — not a bulk reassign.
const ALL_STATUSES: ParticipantStatus[] = [
  "new",
  "info_verified",
  "cs_enriched",
  "active",
  "inactive",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function combinedName(r: ParticipantRow): string {
  const en = r.name_en?.trim();
  const cn = r.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

function csName(a: CsAdmin): string {
  const en = a.name_en?.trim();
  const cn = a.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

type BulkAction =
  | "archive"
  | "unarchive"
  | "delete"
  | "set_status"
  | "assign_cs";

type Toast = {
  message: string;
  undo?: () => Promise<void>;
} | null;

export function ParticipantsTable({
  rows,
  adminRole,
  hasFilters,
  customerService,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | "export" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [openMenu, setOpenMenu] = useState<"status" | "cs" | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Clear selection when the row set changes (filter/page/refresh).
  const rowKey = useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
  useEffect(() => {
    setSelected(new Set());
    setError(null);
  }, [rowKey]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const indeterminate = someOnPage && !allOnPage;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  // Close open menu on outside click / Escape.
  useEffect(() => {
    if (!openMenu) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Auto-dismiss toast after 5s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOnPage) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function postBulk(body: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/admin/participants/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(
        payload.error ?? `Bulk ${String(body.action)} failed (${res.status})`,
      );
    }
  }

  async function runArchive(action: "archive" | "unarchive") {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBusy(action);
    setError(null);
    try {
      await postBulk({ action, ids });
      const count = ids.length;
      const verb = action === "archive" ? "archived" : "unarchived";
      setSelected(new Set());
      router.refresh();
      setToast({
        message: `${count.toLocaleString()} participant${count === 1 ? "" : "s"} ${verb}`,
        undo: async () => {
          setBusy("undo");
          try {
            await postBulk({
              action: action === "archive" ? "unarchive" : "archive",
              ids,
            });
            router.refresh();
            setToast(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Undo failed");
          } finally {
            setBusy(null);
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Bulk ${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function runDelete() {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Permanently delete ${selected.size} participant${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      await postBulk({ action: "delete", ids: Array.from(selected) });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSetStatus(next: ParticipantStatus) {
    if (selected.size === 0) return;
    setOpenMenu(null);
    setBusy("set_status");
    setError(null);
    try {
      const ids = Array.from(selected);
      await postBulk({ action: "set_status", ids, status: next });
      const count = ids.length;
      setSelected(new Set());
      router.refresh();
      setToast({
        message: `${count.toLocaleString()} set to ${STATUS_LABEL[next]}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Set status failed");
    } finally {
      setBusy(null);
    }
  }

  async function runAssignCs(adminId: string | null) {
    if (selected.size === 0) return;
    setOpenMenu(null);
    setBusy("assign_cs");
    setError(null);
    try {
      const ids = Array.from(selected);
      await postBulk({ action: "assign_cs", ids, assigned_cs_id: adminId });
      const who =
        adminId === null
          ? "unassigned"
          : `assigned to ${csName(customerService.find((a) => a.id === adminId) ?? { id: "", name_en: "—", name_cn: null, role: "" })}`;
      const count = ids.length;
      setSelected(new Set());
      router.refresh();
      setToast({
        message: `${count.toLocaleString()} ${who}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign CS failed");
    } finally {
      setBusy(null);
    }
  }

  function exportSelected() {
    if (selected.size === 0) return;
    setBusy("export");
    const ids = Array.from(selected).join(",");
    window.location.href = `/api/admin/participants/export?ids=${encodeURIComponent(ids)}`;
    setTimeout(() => setBusy(null), 1500);
  }

  const count = selected.size;
  const canDelete = adminRole === "super_admin";

  return (
    <div
      className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 shadow-[var(--shadow-paper-1)] overflow-hidden"
    >
      {/* Bulk action bar */}
      {count > 0 ? (
        <div
          ref={menuRef}
          className="relative flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--cinnabar-wash)]/60"
        >
          <div className="inline-flex items-center gap-2 text-[12px] text-[var(--cinnabar-deep)] mr-1">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="inline-flex items-center justify-center w-5 h-5 rounded-[4px] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar)] hover:bg-[var(--cinnabar)]/10 transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 5h5" />
              </svg>
            </button>
            <span className="font-medium tabular-nums">
              {count.toLocaleString()} selected
            </span>
          </div>

          <div className="h-5 w-px bg-[var(--cinnabar)]/20" aria-hidden="true" />

          <BulkButton
            label="Archive"
            onClick={() => runArchive("archive")}
            busy={busy === "archive"}
            disabled={busy !== null}
          />
          <BulkButton
            label="Unarchive"
            onClick={() => runArchive("unarchive")}
            busy={busy === "unarchive"}
            disabled={busy !== null}
          />

          {/* Set status dropdown */}
          <div className="relative">
            <BulkButton
              label="Set status"
              caret
              onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
              busy={busy === "set_status"}
              disabled={busy !== null}
              active={openMenu === "status"}
            />
            {openMenu === "status" ? (
              <Menu>
                {ALL_STATUSES.map((s) => {
                  const tone = STATUS_TONE[s];
                  return (
                    <MenuItem key={s} onClick={() => runSetStatus(s)}>
                      <span
                        className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-full border text-[10px] tracking-[0.14em] uppercase ${tone.bg} ${tone.ring} ${tone.text}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                          aria-hidden="true"
                        />
                        {STATUS_LABEL[s]}
                      </span>
                      <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                        {STATUS_ZH[s]}
                      </span>
                    </MenuItem>
                  );
                })}
              </Menu>
            ) : null}
          </div>

          {/* Assign CS dropdown */}
          <div className="relative">
            <BulkButton
              label="Assign CS"
              caret
              onClick={() => setOpenMenu(openMenu === "cs" ? null : "cs")}
              busy={busy === "assign_cs"}
              disabled={busy !== null || customerService.length === 0}
              active={openMenu === "cs"}
            />
            {openMenu === "cs" ? (
              <Menu>
                <MenuItem onClick={() => runAssignCs(null)}>
                  <span className="text-[12px] text-[var(--ink-mute)] italic">
                    Unassigned
                  </span>
                </MenuItem>
                <div
                  className="my-1 h-px bg-[var(--paper-shadow)]"
                  aria-hidden="true"
                />
                {customerService.map((a) => (
                  <MenuItem key={a.id} onClick={() => runAssignCs(a.id)}>
                    <span className="text-[12.5px] text-[var(--ink)] truncate">
                      {csName(a)}
                    </span>
                    <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                      {a.role === "super_admin" ? "Super" : "CS"}
                    </span>
                  </MenuItem>
                ))}
              </Menu>
            ) : null}
          </div>

          <BulkButton
            label="Export CSV"
            onClick={exportSelected}
            busy={busy === "export"}
            disabled={busy !== null}
          />

          {canDelete ? (
            <BulkButton
              label="Delete"
              onClick={runDelete}
              busy={busy === "delete"}
              disabled={busy !== null}
              tone="danger"
            />
          ) : null}

          {error ? (
            <div className="ml-auto text-[12px] text-[var(--cinnabar-deep)] font-medium">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
          <thead className="bg-[var(--paper-deep)]/70 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            <tr>
              <th scope="col" className="w-10 pl-5 pr-2 py-3.5">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allOnPage}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                  aria-label="Select all on page"
                  className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
              </th>
              <th scope="col" className="px-5 py-3.5 font-medium">Student ID</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Name</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Region</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Contact</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Score</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Registered</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center">
                  <div className="inline-flex flex-col items-center gap-3">
                    <span
                      className="inline-flex items-center justify-center w-10 h-10 rounded-full
                                 border border-[var(--paper-shadow)] bg-[var(--paper)]
                                 text-[var(--cinnabar)]"
                      aria-hidden="true"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="6" r="2.6" />
                        <path d="M3 13.2a5 5 0 0 1 10 0" />
                      </svg>
                    </span>
                    <div className="text-[13px] text-[var(--ink)]">
                      {hasFilters
                        ? "No participants match these filters"
                        : "No participants yet"}
                    </div>
                    <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                      {hasFilters
                        ? "Try widening the filters or clearing search."
                        : "Public registrations will appear here as soon as the first student submits."}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const tone = STATUS_TONE[r.status];
                const isArchived = Boolean(r.archived_at);
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-[var(--paper-shadow)]
                               hover:bg-[var(--paper-deep)]/55
                               transition-colors duration-[var(--dur-fast)]
                               has-[a:focus-visible]:bg-[var(--paper-deep)]/55
                               ${isArchived ? "opacity-70" : ""}
                               ${isSelected ? "bg-[var(--cinnabar-wash)]/40" : ""}`}
                  >
                    <td className="w-10 pl-5 pr-2 py-3.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(r.id)}
                        aria-label={`Select ${combinedName(r)}`}
                        className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[12px] text-[var(--ink)] whitespace-nowrap">
                      <Link
                        href={`/admin/participants/${r.id}`}
                        className="inline-block min-w-full hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                      >
                        {r.region_id ?? (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink)] font-medium">
                      <Link
                        href={`/admin/participants/${r.id}`}
                        className="hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                      >
                        {combinedName(r)}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)]">
                      {r.region ?? (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)] max-w-[200px] truncate">
                      {r.email ?? (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                      text-[10px] tracking-[0.14em] uppercase
                                      ${tone.bg} ${tone.ring} ${tone.text}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                            aria-hidden="true"
                          />
                          {STATUS_LABEL[r.status]}
                        </span>
                        {isArchived ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] text-[9px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
                            Archived
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {typeof r.overall_score === "number" ? (
                        <span className="font-display text-[15px] text-[var(--ink)]">
                          {r.overall_score}
                          <span className="text-[var(--ink-faint)] text-[11px] ml-0.5">/10</span>
                        </span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-[var(--ink-mute)] whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="toast-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                     inline-flex items-center gap-4 pl-5 pr-2 py-2
                     rounded-[var(--radius-pill)]
                     bg-[var(--ink)] text-[var(--paper-warm)]
                     shadow-[0_12px_32px_rgba(11,41,84,0.28)]"
        >
          <span className="text-[13px] tracking-[0.02em]">{toast.message}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={toast.undo}
              disabled={busy === "undo"}
              className="inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)]
                         bg-[var(--paper-warm)]/10 hover:bg-[var(--paper-warm)]/20
                         text-[12px] tracking-[0.06em] font-medium
                         text-[var(--paper-warm)]
                         transition-colors duration-[var(--dur-fast)]
                         disabled:opacity-60 disabled:cursor-not-allowed
                         focus-visible:shadow-[var(--shadow-focus)]"
            >
              {busy === "undo" ? "Undoing…" : "Undo"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--paper-warm)]/70 hover:text-[var(--paper-warm)] hover:bg-[var(--paper-warm)]/10 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      ) : null}

    </div>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <ul
      role="listbox"
      className="absolute top-full left-0 mt-2 z-30 min-w-[220px]
                 rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                 bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)]
                 py-1.5 max-h-[320px] overflow-y-auto"
    >
      {children}
    </ul>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        role="option"
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left
                   transition-colors duration-[var(--dur-fast)]
                   text-[var(--ink-soft)]
                   hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
      >
        {children}
      </button>
    </li>
  );
}

function BulkButton({
  label,
  onClick,
  busy,
  disabled,
  tone = "default",
  caret = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone?: "default" | "danger";
  caret?: boolean;
  active?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] font-medium border transition-[background-color,border-color,color] duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:shadow-[var(--shadow-focus)]";
  const toneCls =
    tone === "danger"
      ? "border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]"
      : active
        ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={caret ? active : undefined}
      className={`${base} ${toneCls}`}
    >
      {busy ? (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
          <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : null}
      {label}
      {caret ? (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="opacity-70"
        >
          <path d="M2.5 4L5 6.5 7.5 4" />
        </svg>
      ) : null}
    </button>
  );
}
