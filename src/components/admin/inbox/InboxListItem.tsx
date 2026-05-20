import Link from "next/link";
import type { ConversationListRow } from "@/lib/inbox/inbox-query";
import {
  CONVERSATION_STATUS_LABEL,
  CONVERSATION_STATUS_TONE,
  toneClasses,
  timeAgo,
  channelLabel,
  participantDisplay,
} from "@/lib/inbox/format";
import { ChannelGlyph } from "./ChannelGlyph";

// A single row in the conversation list. Two visual modes:
//   - default: carded (border + shadow + per-item padding) — used in the
//     `<xl` inline fallback rendered inside inbox/page.tsx.
//   - compact: flat WhatsApp-style row (no border, no shadow, just
//     vertical padding + hover/active bg tint) — used in the persistent
//     `@list` slot column at xl+.
//
// Server component. Active-thread highlight derives from the `activePath`
// prop (server-supplied via `x-pathname` header from @list/default.tsx).

export function InboxListItem({
  row,
  activePath,
  compact = false,
}: {
  row: ConversationListRow;
  activePath?: string;
  compact?: boolean;
}) {
  const isActive = activePath === `/admin/inbox/${row.id}`;
  return compact ? (
    <CompactItem row={row} isActive={isActive} />
  ) : (
    <CardedItem row={row} isActive={isActive} />
  );
}

// -----------------------------------------------------------------------------
// Compact (WhatsApp-style)
// -----------------------------------------------------------------------------

function CompactItem({
  row,
  isActive,
}: {
  row: ConversationListRow;
  isActive: boolean;
}) {
  const p = row.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const isLead = p?.status === "lead";

  return (
    <li>
      <Link
        href={`/admin/inbox/${row.id}`}
        aria-current={isActive ? "page" : undefined}
        className={[
          "group relative flex items-center gap-3 px-3 py-3",
          "border-b border-[var(--paper-shadow)]/60",
          "transition-[background-color] duration-[var(--dur-fast)]",
          isActive
            ? "bg-[var(--paper-deep)]"
            : "bg-transparent hover:bg-[var(--paper-deep)]/60",
        ].join(" ")}
      >
        <div className="flex-none relative">
          <div
            className="w-10 h-10 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]
                       flex items-center justify-center text-[11px] tracking-[0.06em] font-medium
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
            aria-hidden="true"
          >
            {initialsFor(displayName)}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--paper-warm)]
                       border border-[var(--paper-shadow)]
                       flex items-center justify-center text-[var(--cinnabar)]"
            aria-label={channelLabel(row.channel)}
            title={channelLabel(row.channel)}
          >
            <ChannelGlyph channel={row.channel} size={8} />
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={[
                "truncate leading-[1.25]",
                hasRealName
                  ? "font-display text-[13.5px] text-[var(--ink)] tracking-[-0.005em]"
                  : "font-mono text-[12px] text-[var(--ink-soft)]",
              ].join(" ")}
            >
              {displayName}
            </span>
            <span className="flex-none text-[10px] tracking-[0.02em] text-[var(--ink-faint)] tabular-nums">
              {timeAgo(row.last_message_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="flex-1 min-w-0 truncate text-[11.5px] text-[var(--ink-mute)] leading-[1.4]">
              {row.last_message_preview?.trim() || (
                <span className="text-[var(--ink-faint)] italic">No messages yet</span>
              )}
            </span>
            {isLead ? (
              <span className="flex-none text-[8.5px] tracking-[0.18em] uppercase text-[var(--gold-deep,var(--ink-mute))] bg-[var(--gold-soft)] border border-[var(--gold)]/40 rounded-[var(--radius-pill)] px-1 py-px">
                Lead
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Carded (original, used in <xl fallback)
// -----------------------------------------------------------------------------

function CardedItem({
  row,
  isActive,
}: {
  row: ConversationListRow;
  isActive: boolean;
}) {
  const p = row.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const regionId = p?.region_id;
  const isLead = p?.status === "lead";
  const statusLabel = CONVERSATION_STATUS_LABEL[row.status]?.en ?? row.status;
  const statusTone = CONVERSATION_STATUS_TONE[row.status] ?? "neutral";
  const assignedName =
    row.assigned_admin?.name_en ?? row.assigned_admin?.name_cn ?? null;

  return (
    <li>
      <Link
        href={`/admin/inbox/${row.id}`}
        aria-current={isActive ? "page" : undefined}
        className={[
          "group relative flex items-center gap-4 px-4 py-3.5 rounded-[var(--radius-md)]",
          "border shadow-[var(--shadow-paper-1)]",
          "transition-[transform,box-shadow,border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          isActive
            ? "border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] shadow-[var(--shadow-paper-2)]"
            : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] hover:-translate-y-[1px] hover:shadow-[var(--shadow-paper-2)] hover:border-[var(--cinnabar)]/20",
        ].join(" ")}
      >
        <div className="flex-none relative">
          <div
            className="w-10 h-10 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]
                       flex items-center justify-center text-[11px] tracking-[0.06em] font-medium
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
            aria-hidden="true"
          >
            {initialsFor(displayName)}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[var(--paper-warm)]
                       border border-[var(--paper-shadow)] shadow-[var(--shadow-paper-1)]
                       flex items-center justify-center text-[var(--cinnabar)]"
            aria-label={channelLabel(row.channel)}
            title={channelLabel(row.channel)}
          >
            <ChannelGlyph channel={row.channel} size={10} />
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {regionId ? (
              <span className="font-mono text-[11.5px] text-[var(--cinnabar-deep)]">
                {regionId}
              </span>
            ) : null}
            <span
              className={`text-[13.5px] text-[var(--ink)] truncate leading-[1.3] ${
                hasRealName ? "" : "font-mono text-[12.5px] text-[var(--ink-soft)]"
              }`}
            >
              {displayName}
            </span>
            {isLead ? (
              <span className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[9px] tracking-[0.22em] uppercase text-[var(--ink)]">
                Lead
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--ink-mute)] truncate leading-[1.5]">
            {row.last_message_preview?.trim() || <span className="text-[var(--ink-faint)] italic">No messages yet</span>}
          </div>
          {row.tags.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {row.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[10px] tracking-[0.1em] text-[var(--ink-mute)]"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex-none flex flex-col items-end gap-1.5 min-w-[96px]">
          <span className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] tabular-nums">
            {timeAgo(row.last_message_at)}
          </span>
          <span
            className={`inline-flex items-center h-[20px] px-1.5 rounded-[var(--radius-pill)] border text-[9.5px] tracking-[0.16em] uppercase ${toneClasses(statusTone)}`}
          >
            {statusLabel}
          </span>
          {assignedName ? (
            <span className="text-[10px] tracking-[0.08em] text-[var(--ink-faint)] truncate max-w-[110px]">
              {assignedName}
            </span>
          ) : (
            <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              Unassigned
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function initialsFor(src: string): string {
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "·";
}
