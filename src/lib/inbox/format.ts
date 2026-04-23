// Client-safe formatters for the Inbox UI. Kept outside server-only modules
// so React client components can import without dragging in Supabase server
// plumbing. Mirrors the split pattern established in `src/lib/finance/format.ts`.

export const CHANNEL_LABEL: Record<string, { en: string; zh: string }> = {
  whatsapp: { en: "WhatsApp", zh: "WhatsApp" },
  line: { en: "LINE", zh: "LINE" },
  email: { en: "Email", zh: "电邮" },
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "—";
  return CHANNEL_LABEL[channel]?.en ?? channel;
}

export const CONVERSATION_STATUS_LABEL: Record<string, { en: string; zh: string }> = {
  open: { en: "Open", zh: "进行中" },
  pending: { en: "Pending", zh: "待处理" },
  snoozed: { en: "Snoozed", zh: "暂缓" },
  closed: { en: "Closed", zh: "已关闭" },
};

export const DELIVERY_STATUS_LABEL: Record<string, { en: string; zh: string }> = {
  pending: { en: "Pending", zh: "待发送" },
  queued: { en: "Queued", zh: "排队" },
  sent: { en: "Sent", zh: "已发送" },
  delivered: { en: "Delivered", zh: "已送达" },
  read: { en: "Read", zh: "已读" },
  failed: { en: "Failed", zh: "失败" },
};

export type StatusTone = "neutral" | "info" | "warn" | "go" | "danger";

export const CONVERSATION_STATUS_TONE: Record<string, StatusTone> = {
  open: "info",
  pending: "warn",
  snoozed: "neutral",
  closed: "neutral",
};

export function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case "go":
      return "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]";
    case "info":
      return "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
    case "warn":
      return "border-[var(--gold)]/35 bg-[var(--gold-soft)] text-[var(--ink)]";
    case "danger":
      return "border-[var(--cinnabar)]/35 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
    case "neutral":
    default:
      return "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]";
  }
}

// Channel chip tone — not a status, but a visual hint for which platform.
export const CHANNEL_TONE: Record<string, StatusTone> = {
  whatsapp: "go",      // green — WhatsApp brand hint without literal green
  line: "info",        // LINE uses green too; we differentiate via cinnabar
  email: "neutral",
};

/**
 * Human-readable relative timestamp. "just now", "3m", "2h", "Tue", "Apr 14".
 * Intentionally terse — used in dense conversation lists.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short" });
  }
  const sameYear = new Date(iso).getFullYear() === new Date().getFullYear();
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Display name for a participant. Falls back through name → phone → email so
 * freshly auto-created leads (no name yet) still render an identifiable label
 * instead of "(unnamed)".
 */
export function participantDisplay(
  p:
    | {
        name_en?: string | null;
        name_cn?: string | null;
        phone?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string {
  if (!p) return "(unknown)";
  const name = (p.name_en ?? p.name_cn ?? "").trim();
  if (name) return name;
  const phone = (p.phone ?? "").trim();
  if (phone) return phone;
  const email = (p.email ?? "").trim();
  if (email) return email;
  return "(unnamed participant)";
}

/**
 * Absolute timestamp for the thread view (tooltip + bubble metadata).
 * Example: "14 Apr, 9:42 PM".
 */
export function timestampFull(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
