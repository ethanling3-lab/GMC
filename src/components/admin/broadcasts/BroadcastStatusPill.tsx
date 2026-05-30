import type { BroadcastStatus } from "@/lib/broadcasts/types";
import { BROADCAST_STATUS_LABEL } from "@/lib/broadcasts/types";

// Matches the DirectionPill aesthetic from the transfer-lists list page:
// rounded-pill, monospace tabular-nums, status-specific color tone. Used
// on both the list table and the detail page header.

const TONE: Record<BroadcastStatus, string> = {
  draft: "border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[var(--ink-soft)]",
  scheduled: "border-[var(--gold)]/30 bg-[var(--gold)]/8 text-[var(--ink-soft)]",
  sending: "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]",
  sent: "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]",
  partial: "border-[var(--gold)]/40 bg-[var(--gold)]/12 text-[var(--ink-soft)]",
  cancelled: "border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] text-[var(--ink-mute)]",
  failed: "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]",
};

export function BroadcastStatusPill({ status }: { status: BroadcastStatus }) {
  const label = BROADCAST_STATUS_LABEL[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 h-[22px] rounded-[var(--radius-pill)] border text-[10.5px] tracking-[0.14em] uppercase tabular-nums ${TONE[status]}`}
    >
      <span className="font-medium">{label.en}</span>
      <span className="text-[var(--ink-faint)]">·</span>
      <span>{label.cn}</span>
    </span>
  );
}

export function BroadcastChannelPill({ channel }: { channel: "whatsapp" | "email" }) {
  const tone =
    channel === "whatsapp"
      ? "border-[#25d366]/30 bg-[#25d366]/8 text-[#1e8d4a]"
      : "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[var(--radius-pill)] border text-[9.5px] tracking-[0.18em] uppercase ${tone}`}
    >
      {channel === "whatsapp" ? "WA" : "Email"}
    </span>
  );
}
