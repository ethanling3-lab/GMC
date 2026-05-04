"use client";

import { useEffect, useRef, useState } from "react";
import { CardShell, Spinner } from "./CardShell";
import { useFaceAnalysis } from "./useFaceAnalysis";
import {
  ARCHETYPES,
  ARCHETYPE_NAMES,
  SKIN_TONES,
  isArchetypeName,
  isSkinTone,
  type ArchetypeName,
  type FaceMeasurements,
  type SkinTone,
} from "@/lib/face-reading/archetypes";

export type FaceReadingInitial = {
  front_photo_url: string | null;
  face_archetype: string | null;
  face_archetype_suggested: string | null;
  face_measurements: FaceMeasurements | { error?: string; diagTips?: string[] } | null;
  face_skin_tone_override: string | null;
  face_analyzed_at: string | null;
  face_analysis_error: string | null;
};

type Props = {
  participantId: string;
  initial: FaceReadingInitial;
};

export function FaceReadingCard({ participantId, initial }: Props) {
  const {
    running,
    saving,
    error,
    setError,
    analyzeAndSave,
    overrideArchetype,
    overrideSkinTone,
  } = useFaceAnalysis(participantId);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const triggerKeyRef = useRef<string | null>(null);

  const hasPhoto = !!initial.front_photo_url;
  const hasAnalysis = !!initial.face_analyzed_at;
  const hasError = !!initial.face_analysis_error;
  const measurements = isMeasurements(initial.face_measurements)
    ? initial.face_measurements
    : null;
  const errorTips = isErrorBlob(initial.face_measurements)
    ? (initial.face_measurements.diagTips ?? [])
    : [];

  // Auto-trigger when a photo exists but no analysis has run yet.
  // Re-trigger whenever the photo URL changes (uploaded a new one).
  useEffect(() => {
    if (!hasPhoto || !initial.front_photo_url) return;
    if (running || saving) return;
    if (hasAnalysis && triggerKeyRef.current === initial.front_photo_url) {
      return;
    }
    if (autoTriggered && triggerKeyRef.current === initial.front_photo_url) {
      return;
    }
    if (hasAnalysis) {
      // Already analyzed for some other photo — only auto-rerun on a new
      // photo URL. We track the URL we last triggered for so a manual
      // re-analyze doesn't get clobbered.
      triggerKeyRef.current = initial.front_photo_url;
      return;
    }
    triggerKeyRef.current = initial.front_photo_url;
    setAutoTriggered(true);
    void analyzeAndSave(initial.front_photo_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.front_photo_url, hasPhoto, hasAnalysis]);

  function reanalyze() {
    if (!initial.front_photo_url) return;
    triggerKeyRef.current = initial.front_photo_url;
    void analyzeAndSave(initial.front_photo_url);
  }

  const confirmedArchetype = isArchetypeName(initial.face_archetype)
    ? initial.face_archetype
    : null;
  const suggestedArchetype = isArchetypeName(initial.face_archetype_suggested)
    ? initial.face_archetype_suggested
    : null;
  const displayArchetype = confirmedArchetype ?? suggestedArchetype;
  const archetypeData = displayArchetype ? ARCHETYPES[displayArchetype] : null;

  const skinToneOverride = isSkinTone(initial.face_skin_tone_override)
    ? initial.face_skin_tone_override
    : null;

  return (
    <CardShell
      eyebrow="Face Reading"
      eyebrowZh="面相"
      title="Archetype analysis"
      editing={false}
      saving={saving}
      error={error}
      editable={false}
    >
      <div className="flex flex-col gap-6">
        {/* Top row: status / actions */}
        <div className="flex items-start justify-between gap-4 flex-wrap -mt-2">
          <div className="flex flex-col gap-1">
            {hasAnalysis && initial.face_analyzed_at ? (
              <span className="text-[11px] text-[var(--ink-mute)]">
                Last analyzed{" "}
                {new Date(initial.face_analyzed_at).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {confirmedArchetype && suggestedArchetype && confirmedArchetype !== suggestedArchetype ? (
              <span className="text-[11px] text-[var(--ink-mute)]">
                Algorithm suggested{" "}
                <span className="text-[var(--ink)]">{suggestedArchetype}</span> —
                admin set to{" "}
                <span className="text-[var(--ink)]">{confirmedArchetype}</span>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {hasPhoto ? (
              <button
                type="button"
                onClick={reanalyze}
                disabled={running || saving}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)]
                           text-[11.5px] tracking-[0.04em] text-[var(--ink-soft)]
                           hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
              >
                {running ? <Spinner /> : (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 6a4 4 0 0 1 7-2.6M10 6a4 4 0 0 1-7 2.6" />
                    <path d="M9 1v3H6M3 11V8h3" />
                  </svg>
                )}
                {running ? "Analyzing" : hasAnalysis ? "Re-analyze" : "Analyze"}
              </button>
            ) : null}
          </div>
        </div>

        {/* No photo */}
        {!hasPhoto ? (
          <EmptyState>
            Upload a front-facing photo to generate a 面相 reading.
          </EmptyState>
        ) : null}

        {/* Running, no prior result */}
        {hasPhoto && !hasAnalysis && (running || saving) ? (
          <EmptyState>
            Loading face-detection models (may take 20–40 seconds on first
            run)…
          </EmptyState>
        ) : null}

        {/* Error from last run */}
        {hasError ? (
          <ErrorPanel
            errorCode={initial.face_analysis_error ?? "analysis_failed"}
            tips={errorTips}
          />
        ) : null}

        {/* Archetype + measurements */}
        {hasPhoto && hasAnalysis && !hasError && archetypeData ? (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-[44px] leading-none" aria-hidden="true">
                  {archetypeData.emoji}
                </span>
                <div>
                  <div className="font-display text-[26px] tracking-[-0.01em] text-[var(--ink)] leading-tight">
                    {archetypeData.name}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--ink-mute)]">
                    {archetypeData.criteria}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 max-w-[320px] justify-end">
                {archetypeData.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.04em] text-[var(--ink)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <p className="text-[13.5px] leading-[1.75] text-[var(--ink-soft)]">
              {archetypeData.desc}
            </p>

            {measurements ? (
              <MetricsGrid
                measurements={measurements}
                skinToneOverride={skinToneOverride}
              />
            ) : null}
          </>
        ) : null}

        {/* Override controls (always shown when we have a photo, so admin
            can correct the archetype even after a failed run) */}
        {hasPhoto ? (
          <OverrideControls
            confirmedArchetype={confirmedArchetype}
            suggestedArchetype={suggestedArchetype}
            skinToneOverride={skinToneOverride}
            measuredSkinTone={
              measurements && isSkinTone(measurements.skinTone)
                ? measurements.skinTone
                : null
            }
            saving={saving}
            onArchetypeChange={async (next) => {
              setError(null);
              await overrideArchetype(next);
            }}
            onSkinToneChange={async (next) => {
              setError(null);
              await overrideSkinTone(next);
            }}
          />
        ) : null}
      </div>
    </CardShell>
  );
}

function MetricsGrid({
  measurements,
  skinToneOverride,
}: {
  measurements: FaceMeasurements;
  skinToneOverride: SkinTone | null;
}) {
  const tone = skinToneOverride ?? measurements.skinTone;
  const rgb = measurements.skinRGB;
  return (
    <div className="grid grid-cols-3 gap-4 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-4">
      <Metric
        label="Face ratio"
        labelZh="脸长 ÷ 脸宽"
        value={measurements.faceRatio.toFixed(3)}
        hint={measurements.isNarrow ? "窄脸 (≥1.45)" : "宽脸 (<1.45)"}
      />
      <Metric
        label="Forehead"
        labelZh="额头 ÷ 下半"
        value={measurements.foreheadRatio.toFixed(3)}
        hint={measurements.isHighForehead ? "高 (≥0.95)" : "低 (<0.95)"}
      />
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
          Skin tone
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            肤色
          </span>
        </div>
        <div className="flex items-center gap-2">
          {rgb ? (
            <span
              className="inline-block w-5 h-5 rounded-full border border-[var(--paper-shadow)]"
              style={{
                backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
              }}
              aria-hidden="true"
            />
          ) : null}
          <span className="font-display text-[18px] text-[var(--ink)]">
            {tone}
          </span>
          {skinToneOverride ? (
            <span className="text-[10px] tracking-[0.16em] uppercase text-[var(--cinnabar)]">
              Override
            </span>
          ) : null}
        </div>
        <div className="text-[10.5px] text-[var(--ink-faint)]">
          {measurements.corsLimited
            ? "CORS limited — tone defaulted"
            : rgb
              ? `RGB ${rgb.r}, ${rgb.g}, ${rgb.b}`
              : ""}
          {measurements.detPass ? ` · ${measurements.detPass}` : ""}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  labelZh,
  value,
  hint,
}: {
  label: string;
  labelZh?: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
        {label}
        {labelZh ? (
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            {labelZh}
          </span>
        ) : null}
      </div>
      <span className="font-display text-[18px] text-[var(--ink)] tabular-nums">
        {value}
      </span>
      {hint ? (
        <span className="text-[10.5px] text-[var(--ink-faint)]">{hint}</span>
      ) : null}
    </div>
  );
}

function OverrideControls({
  confirmedArchetype,
  suggestedArchetype,
  skinToneOverride,
  measuredSkinTone,
  saving,
  onArchetypeChange,
  onSkinToneChange,
}: {
  confirmedArchetype: ArchetypeName | null;
  suggestedArchetype: ArchetypeName | null;
  skinToneOverride: SkinTone | null;
  measuredSkinTone: SkinTone | null;
  saving: boolean;
  onArchetypeChange: (next: ArchetypeName | null) => void | Promise<void>;
  onSkinToneChange: (next: SkinTone | null) => void | Promise<void>;
}) {
  const isAuto = !confirmedArchetype || confirmedArchetype === suggestedArchetype;
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 p-4 flex flex-col gap-4">
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        Manual override · 手动调整
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
          Archetype
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            面相
          </span>
        </span>
        <select
          value={isAuto ? "" : confirmedArchetype ?? ""}
          disabled={saving}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") {
              // "Auto" — clear admin override (revert to suggestion).
              onArchetypeChange(suggestedArchetype);
              return;
            }
            if (isArchetypeName(v)) onArchetypeChange(v);
          }}
          className="h-9 px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] disabled:opacity-60"
        >
          <option value="">
            Auto · 算法建议{suggestedArchetype ? ` (${suggestedArchetype})` : ""}
          </option>
          {ARCHETYPE_NAMES.map((n) => {
            const a = ARCHETYPES[n];
            return (
              <option key={n} value={n}>
                {a.emoji} {n} — {a.criteria}
              </option>
            );
          })}
        </select>
        <span className="text-[11px] text-[var(--ink-faint)]">
          Photos that have been edited or filtered may mislead the algorithm —
          pick the right archetype here if needed.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
          Skin tone
          <span className="ml-1.5 text-[var(--ink-faint)]/70 normal-case tracking-[0.14em]">
            肤色
          </span>
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {SKIN_TONES.map((t) => {
            const active = skinToneOverride === t;
            return (
              <button
                type="button"
                key={t}
                onClick={() => onSkinToneChange(t)}
                disabled={saving}
                className={`h-8 px-3 rounded-[var(--radius-pill)] border text-[12px] tracking-[0.04em] transition-[background-color,border-color,color] duration-[var(--dur-fast)] disabled:opacity-50 ${
                  active
                    ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]"
                }`}
              >
                {t}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onSkinToneChange(null)}
            disabled={saving || !skinToneOverride}
            className="h-8 px-3 rounded-[var(--radius-pill)] text-[12px] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] disabled:opacity-40 disabled:hover:text-[var(--ink-mute)] transition-colors"
          >
            Reset{measuredSkinTone ? ` → ${measuredSkinTone}` : ""}
          </button>
        </div>
        <span className="text-[11px] text-[var(--ink-faint)]">
          Overriding skin tone re-classifies the archetype against the existing measurements.
        </span>
      </div>
    </div>
  );
}

function ErrorPanel({
  errorCode,
  tips,
}: {
  errorCode: string;
  tips: string[];
}) {
  const label =
    errorCode === "no_face_detected"
      ? "未检测到人脸 · No face detected"
      : errorCode === "image_load_failed"
        ? "图片加载失败 · Image failed to load"
        : "分析失败 · Analysis failed";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 flex flex-col gap-2">
      <div className="text-[12px] tracking-[0.04em] text-[var(--cinnabar-deep)] font-medium">
        {label}
      </div>
      {tips.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[12px] leading-[1.6] text-[var(--ink-soft)]">
          {tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}
      <span className="text-[11px] text-[var(--ink-faint)]">
        You can pick the correct 面相 manually below — the algorithm result
        is not blocking.
      </span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/40 px-4 py-6 text-center text-[12.5px] text-[var(--ink-mute)] leading-[1.7]">
      {children}
    </div>
  );
}

function isMeasurements(v: unknown): v is FaceMeasurements {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.faceRatio === "number" &&
    typeof m.foreheadRatio === "number" &&
    typeof m.skinTone === "string"
  );
}

function isErrorBlob(v: unknown): v is { error?: string; diagTips?: string[] } {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return "error" in m || "diagTips" in m;
}
