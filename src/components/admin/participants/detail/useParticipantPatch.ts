"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export function useParticipantPatch(participantId: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    async (fields: Record<string, unknown>): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/participants/${participantId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error ?? `Save failed (${res.status})`);
        }
        router.refresh();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        setError(msg);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [participantId, router],
  );

  return { saving, error, setError, patch };
}
