import type { ParticipantStatus } from "@/lib/participants-query";

export const STATUS_LABEL: Record<ParticipantStatus, { en: string; zh: string }> = {
  new: { en: "New", zh: "新" },
  info_verified: { en: "Info Verified", zh: "信息已核" },
  cs_enriched: { en: "CS Enriched", zh: "资料完善" },
  active: { en: "Active", zh: "活跃" },
  inactive: { en: "Inactive", zh: "停用" },
};

const TONE: Record<
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
};

export function StatusPill({
  status,
  size = "sm",
}: {
  status: ParticipantStatus;
  size?: "sm" | "md";
}) {
  const tone = TONE[status];
  const label = STATUS_LABEL[status];
  const sizing =
    size === "md"
      ? "px-3 py-1.5 text-[11px] gap-2.5"
      : "px-2.5 py-1 text-[10px] gap-2";
  return (
    <span
      className={`inline-flex items-center rounded-full border tracking-[0.14em] uppercase
                  ${sizing} ${tone.bg} ${tone.ring} ${tone.text}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
        aria-hidden="true"
      />
      {label.en}
    </span>
  );
}
