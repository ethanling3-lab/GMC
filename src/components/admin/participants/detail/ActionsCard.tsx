"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  participantId: string;
  regionIdDisplay: string | null;
  archivedAt: string | null;
  canDelete: boolean;
};

export function ActionsCard({
  participantId,
  regionIdDisplay,
  archivedAt,
  canDelete,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"delete" | null>(null);
  const archived = Boolean(archivedAt);

  async function toggleArchive() {
    setError(null);
    setBusy("archive");
    try {
      const res = await fetch(
        `/api/admin/participants/${participantId}/archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: archived ? "unarchive" : "archive",
          }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    setError(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/participants/${participantId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      router.push("/admin/participants");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      setError(msg);
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-5">
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        Actions · 操作
      </div>
      <h3 className="mt-2 font-display text-[17px] leading-[1.25] text-[var(--ink)]">
        Archive &amp; delete
      </h3>

      {/* Archive */}
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[var(--ink)]">
            {archived ? "Unarchive" : "Archive"}
          </div>
          <p className="mt-1 text-[12px] leading-[1.6] text-[var(--ink-soft)]">
            {archived
              ? "Return this participant to the active list. Enrollments and scoring stay intact."
              : "Hide from the default list without losing data. Can be restored any time."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleArchive}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-pill)]
                     border border-[var(--paper-shadow)] bg-[var(--paper)]
                     text-[12px] text-[var(--ink-soft)]
                     hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     focus-visible:shadow-[var(--shadow-focus)]
                     transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                     flex-none"
        >
          {busy === "archive" ? (
            <>
              <Spinner />
              {archived ? "Restoring" : "Archiving"}
            </>
          ) : archived ? (
            "Unarchive"
          ) : (
            "Archive"
          )}
        </button>
      </div>

      {/* Delete (super_admin only) */}
      {canDelete ? (
        <>
          <div className="my-5 border-t border-dashed border-[var(--paper-shadow)]" />

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[var(--ink)]">
                Delete permanently
              </div>
              <p className="mt-1 text-[12px] leading-[1.6] text-[var(--ink-soft)]">
                Removes the row and releases region ID{" "}
                {regionIdDisplay ? (
                  <span className="font-mono text-[11px] text-[var(--ink)]">
                    {regionIdDisplay}
                  </span>
                ) : null}
                . Unrecoverable. Prefer archive unless this is spam or a duplicate.
              </p>
            </div>
            {confirming === "delete" ? (
              <div className="flex flex-col items-end gap-2 flex-none">
                <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
                  Sure?
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={busy !== null}
                    className="h-8 px-3 rounded-[var(--radius-pill)] text-[11.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[var(--radius-pill)]
                               bg-[var(--cinnabar)] text-[var(--paper-warm)]
                               text-[11.5px] tracking-[0.04em] font-medium
                               hover:bg-[var(--cinnabar-deep)] shadow-[0_3px_10px_rgba(37,99,235,0.22)]
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-[background-color,transform] duration-[var(--dur-fast)]
                               active:scale-[0.98]"
                  >
                    {busy === "delete" ? (
                      <>
                        <Spinner />
                        Deleting
                      </>
                    ) : (
                      "Delete forever"
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming("delete")}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-pill)]
                           border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]
                           text-[12px] text-[var(--cinnabar-deep)]
                           hover:bg-[var(--cinnabar)]/15 hover:border-[var(--cinnabar)]/50
                           disabled:opacity-50 disabled:cursor-not-allowed
                           focus-visible:shadow-[var(--shadow-focus)]
                           transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                           flex-none"
              >
                Delete
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-5 pt-4 border-t border-dashed border-[var(--paper-shadow)] text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          Delete is super-admin only — archive instead.
        </div>
      )}

      {error ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3.5 py-2 text-[12.5px] leading-[1.55] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
