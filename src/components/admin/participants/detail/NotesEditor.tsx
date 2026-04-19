"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { Textarea } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

export function NotesEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initial ?? "");
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setDraft(initial ?? "");
    setEditing(false);
    setError(null);
  }

  async function save() {
    const ok = await patch({ cs_notes: draft });
    if (ok) setEditing(false);
  }

  return (
    <CardShell
      eyebrow="Notes"
      eyebrowZh="备注"
      title="CS notes"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <Textarea
          value={draft}
          onChange={setDraft}
          rows={8}
          placeholder="Enrichment notes, follow-ups, meeting context…"
        />
      ) : initial ? (
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.8] text-[var(--ink-soft)]">
          {initial}
        </p>
      ) : (
        <div className="flex items-start gap-3 text-[13px] text-[var(--ink-mute)]">
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-faint)]"
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h6M3 6h6M3 8h4" />
            </svg>
          </span>
          <div>
            <div className="text-[13px] text-[var(--ink)]">No notes yet</div>
            <p className="mt-1 text-[12px] leading-[1.65]">
              Click edit to capture enrichment context, follow-ups, or reminders.
            </p>
          </div>
        </div>
      )}
    </CardShell>
  );
}
