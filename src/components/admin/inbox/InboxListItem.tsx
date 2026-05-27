"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
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
import { useSelectionOptional } from "./selection/SelectionContext";

// A single row in the conversation list. Two visual modes:
//   - default: carded (border + shadow + per-item padding) — used in the
//     `<xl` inline fallback rendered inside inbox/page.tsx.
//   - compact: flat WhatsApp-style row (no border, no shadow, just
//     vertical padding + hover/active bg tint) — used in the persistent
//     `@list` slot column at xl+.
//
// Now a CLIENT component — it subscribes to the SelectionContext so the
// avatar doubles as a checkbox (hover or any-selected reveals it) and the
// row tints when selected / when focused via j/k.

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
  const sel = useSelectionOptional();
  const isSelected = sel?.selected.has(row.id) ?? false;
  const isFocused = sel?.focusedId === row.id && sel?.keyboardMode === true;
  const anySelected = (sel?.selected.size ?? 0) > 0;

  const onCheckboxClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    sel?.toggle(row.id);
  };

  return compact ? (
    <CompactItem
      row={row}
      isActive={isActive}
      isSelected={isSelected}
      isFocused={isFocused}
      anySelected={anySelected}
      onCheckboxClick={onCheckboxClick}
    />
  ) : (
    <CardedItem
      row={row}
      isActive={isActive}
      isSelected={isSelected}
      isFocused={isFocused}
      anySelected={anySelected}
      onCheckboxClick={onCheckboxClick}
    />
  );
}

type RowProps = {
  row: ConversationListRow;
  isActive: boolean;
  isSelected: boolean;
  isFocused: boolean;
  anySelected: boolean;
  onCheckboxClick: (e: MouseEvent<HTMLButtonElement>) => void;
};

// -----------------------------------------------------------------------------
// Compact (WhatsApp-style)
// -----------------------------------------------------------------------------

function CompactItem({
  row,
  isActive,
  isSelected,
  isFocused,
  anySelected,
  onCheckboxClick,
}: RowProps) {
  const p = row.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const isLead = p?.status === "lead";

  // Selection state takes visual priority over the active-thread tint so
  // bulk operations stay legible.
  const bgClass = isSelected
    ? "bg-[var(--cinnabar-wash)]"
    : isActive
      ? "bg-[var(--paper-deep)]"
      : "bg-transparent hover:bg-[var(--paper-deep)]/60";

  return (
    <li data-inbox-row-id={row.id} className="group/row relative">
      {isFocused ? <FocusRing /> : null}
      {isSelected ? <SelectedEdge /> : null}
      <Link
        href={`/admin/inbox/${row.id}`}
        aria-current={isActive ? "page" : undefined}
        className={[
          "relative flex items-center gap-3 px-3 py-3",
          "border-b border-[var(--paper-shadow)]/60",
          "transition-[background-color] duration-[var(--dur-fast)]",
          bgClass,
        ].join(" ")}
      >
        <AvatarCheckbox
          displayName={displayName}
          channel={row.channel}
          size="md"
          isSelected={isSelected}
          anySelected={anySelected}
          onCheckboxClick={onCheckboxClick}
        />

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
  isSelected,
  isFocused,
  anySelected,
  onCheckboxClick,
}: RowProps) {
  const p = row.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const regionId = p?.region_id;
  const isLead = p?.status === "lead";
  const statusLabel = CONVERSATION_STATUS_LABEL[row.status]?.en ?? row.status;
  const statusTone = CONVERSATION_STATUS_TONE[row.status] ?? "neutral";
  const assignedName =
    row.assigned_admin?.name_en ?? row.assigned_admin?.name_cn ?? null;

  const stateClass = isSelected
    ? "border-[var(--cinnabar)]/55 bg-[var(--cinnabar-wash)] shadow-[var(--shadow-paper-2)]"
    : isActive
      ? "border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] shadow-[var(--shadow-paper-2)]"
      : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] hover:-translate-y-[1px] hover:shadow-[var(--shadow-paper-2)] hover:border-[var(--cinnabar)]/20";

  return (
    <li data-inbox-row-id={row.id} className="group/row relative">
      {isFocused ? <FocusRing rounded /> : null}
      <Link
        href={`/admin/inbox/${row.id}`}
        aria-current={isActive ? "page" : undefined}
        className={[
          "relative flex items-center gap-4 px-4 py-3.5 rounded-[var(--radius-md)]",
          "border shadow-[var(--shadow-paper-1)]",
          "transition-[transform,box-shadow,border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          stateClass,
        ].join(" ")}
      >
        <AvatarCheckbox
          displayName={displayName}
          channel={row.channel}
          size="lg"
          isSelected={isSelected}
          anySelected={anySelected}
          onCheckboxClick={onCheckboxClick}
        />

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

// -----------------------------------------------------------------------------
// Avatar that doubles as a selection checkbox.
// -----------------------------------------------------------------------------

function AvatarCheckbox({
  displayName,
  channel,
  size,
  isSelected,
  anySelected,
  onCheckboxClick,
}: {
  displayName: string;
  channel: string;
  size: "md" | "lg";
  isSelected: boolean;
  anySelected: boolean;
  onCheckboxClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  // md = compact list (10x10 circle, smaller glyph badge)
  // lg = carded fallback (10x10 circle, larger glyph badge)
  // — actual size is the same (40px) but the badge differs.
  const reveal = isSelected || anySelected; // always show in selection mode
  const ariaLabel = isSelected
    ? `Unselect ${displayName}`
    : `Select ${displayName}`;

  return (
    <div className="flex-none relative">
      <button
        type="button"
        onClick={onCheckboxClick}
        aria-pressed={isSelected}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={[
          "relative w-10 h-10 rounded-full overflow-hidden",
          "flex items-center justify-center",
          "transition-[background-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          isSelected
            ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
            : "bg-[var(--ink)] text-[var(--paper-warm)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[var(--cinnabar-deep)] focus-visible:bg-[var(--cinnabar-deep)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        ].join(" ")}
      >
        {/* Initials layer */}
        <span
          aria-hidden="true"
          className={[
            "absolute inset-0 flex items-center justify-center text-[11px] tracking-[0.06em] font-medium",
            "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            // Hide initials when selected, or on hover-reveal in selection mode
            isSelected
              ? "opacity-0"
              : reveal
                ? "opacity-100 group-hover/row:opacity-0"
                : "opacity-100 group-hover/row:opacity-0",
          ].join(" ")}
        >
          {initialsFor(displayName)}
        </span>

        {/* Checkbox layer */}
        <span
          aria-hidden="true"
          className={[
            "absolute inset-0 flex items-center justify-center",
            "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            isSelected
              ? "opacity-100"
              : reveal
                ? "opacity-0 group-hover/row:opacity-100"
                : "opacity-0 group-hover/row:opacity-100",
          ].join(" ")}
        >
          {isSelected ? <CheckIcon /> : <CircleIcon />}
        </span>
      </button>

      {/* Channel glyph badge — sits in corner, stays visible. */}
      <span
        className={[
          "absolute -bottom-0.5 -right-0.5 rounded-full bg-[var(--paper-warm)]",
          "border border-[var(--paper-shadow)]",
          "flex items-center justify-center text-[var(--cinnabar)]",
          size === "md"
            ? "w-4 h-4"
            : "w-5 h-5 shadow-[var(--shadow-paper-1)]",
        ].join(" ")}
        aria-label={channelLabel(channel)}
        title={channelLabel(channel)}
      >
        <ChannelGlyph channel={channel} size={size === "md" ? 8 : 10} />
      </span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="7" />
    </svg>
  );
}

function FocusRing({ rounded = false }: { rounded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "pointer-events-none absolute inset-0 z-10",
        "shadow-[inset_0_0_0_2px_var(--cinnabar)]",
        rounded ? "rounded-[var(--radius-md)]" : "",
      ].join(" ")}
    />
  );
}

function SelectedEdge() {
  // Subtle cinnabar accent bar on the left edge — only used in compact mode
  // since carded already gets a full cinnabar border when selected.
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--cinnabar)]"
    />
  );
}

function initialsFor(src: string): string {
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "·";
}
