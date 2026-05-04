"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeImage,
  type AnalysisResult,
} from "@/lib/face-reading/analyzer.client";
import type {
  ArchetypeName,
  SkinTone,
} from "@/lib/face-reading/archetypes";

export function useFaceAnalysis(participantId: string) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeAndSave = useCallback(
    async (imageUrl: string): Promise<AnalysisResult | null> => {
      setError(null);
      setRunning(true);
      let result: AnalysisResult | null = null;
      try {
        result = await analyzeImage(imageUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        setError(msg);
        setRunning(false);
        return null;
      }
      setRunning(false);

      setSaving(true);
      try {
        const res = await fetch(
          `/api/admin/participants/${participantId}/face-reading`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          },
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error ?? `Save failed (${res.status})`);
        }
        router.refresh();
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        setError(msg);
        return result;
      } finally {
        setSaving(false);
      }
    },
    [participantId, router],
  );

  const overrideArchetype = useCallback(
    async (archetype: ArchetypeName | null): Promise<boolean> => {
      setError(null);
      setSaving(true);
      try {
        const res = await fetch(
          `/api/admin/participants/${participantId}/face-reading`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ face_archetype: archetype }),
          },
        );
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

  const overrideSkinTone = useCallback(
    async (skinTone: SkinTone | null): Promise<boolean> => {
      setError(null);
      setSaving(true);
      try {
        const res = await fetch(
          `/api/admin/participants/${participantId}/face-reading`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ face_skin_tone_override: skinTone }),
          },
        );
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

  return {
    running,
    saving,
    error,
    setError,
    analyzeAndSave,
    overrideArchetype,
    overrideSkinTone,
  };
}
