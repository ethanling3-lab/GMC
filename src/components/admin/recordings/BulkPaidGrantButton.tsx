"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Two-click arm pattern (same as transfer-lists / broadcasts). First click
// arms, second click within 3s fires the bulk-paid grant.

export function BulkPaidGrantButton({
  eventId,
  recordingId,
}: {
  eventId: string;
  recordingId: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function fire() {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/recordings/${encodeURIComponent(recordingId)}/grants/bulk-paid`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDone(`Failed: ${json?.detail ?? res.status}`);
      } else {
        setDone(`Granted to ${json.count} paid · 已授予 ${json.count}`);
      }
    } finally {
      setBusy(false);
      setArmed(false);
      window.setTimeout(() => {
        setDone(null);
        router.refresh();
      }, 2000);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      {done ? (
        <span className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
          {done}
        </span>
      ) : null}
      <button
        type="button"
        onClick={fire}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-[var(--radius-md)] border text-[11.5px] tracking-[0.1em] uppercase transition-colors ${
          armed
            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
            : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
        } disabled:opacity-50`}
        style={armed ? { color: "var(--paper-warm)" } : { color: "var(--ink-soft)" }}
      >
        {busy ? "Granting…" : armed ? "Click again to grant" : "Grant to paid · 授予已付款"}
      </button>
    </div>
  );
}
