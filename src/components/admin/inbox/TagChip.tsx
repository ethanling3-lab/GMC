"use client";

import { readableTextColor, tintHex } from "@/lib/inbox/tags-types";

// Atomic colored chip for a tag. Used in:
//   - ConversationTagStrip (thread header)   — `variant="solid"`, removable
//   - InboxSidebar tag filter section          — `variant="ghost"`, link
//   - Inbox list row tag badge                 — `variant="ghost"`, static
//
// Colour treatment: "solid" uses the tag's hex as background with auto
// light/dark text; "ghost" uses a soft tint background + the hex as a
// 4px leading dot + the tag's hex as the text colour (so the chip blends
// with paper-warm but stays unambiguous).

type Variant = "solid" | "ghost";

export function TagChip({
  label,
  color,
  variant = "ghost",
  onRemove,
  onClick,
  active = false,
  title,
  size = "md",
}: {
  label: string;
  color: string;
  variant?: Variant;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  size?: "sm" | "md";
}) {
  const isSolid = variant === "solid";
  const text = isSolid ? (readableTextColor(color) === "light" ? "#FFFFFF" : "#1a1a1a") : color;
  const bg = isSolid ? color : tintHex(color, active ? 0.18 : 0.1);
  const border = isSolid ? color : tintHex(color, active ? 0.4 : 0.22);

  const heightCls = size === "sm" ? "h-6 text-[10.5px]" : "h-7 text-[11.5px]";
  const padding = size === "sm" ? "pl-2 pr-1.5" : "pl-2.5 pr-2";

  const interactive = Boolean(onClick);
  const Tag = interactive ? "button" : "span";

  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      title={title ?? label}
      style={{
        backgroundColor: bg,
        borderColor: border,
        color: text,
      }}
      className={[
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border",
        "transition-[background-color,border-color,opacity] duration-[var(--dur-fast)]",
        heightCls,
        onRemove ? "pl-2.5 pr-1" : padding,
        interactive ? "hover:opacity-90 focus-visible:shadow-[var(--shadow-focus)] cursor-pointer" : "",
      ].join(" ")}
    >
      {!isSolid ? (
        <span
          aria-hidden="true"
          className="flex-none w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="truncate max-w-[140px] font-display tracking-[-0.005em]">
        {label}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${label}`}
          className="flex-none inline-flex items-center justify-center w-4 h-4 rounded-full opacity-70 hover:opacity-100 transition-opacity duration-[var(--dur-fast)]"
        >
          <svg width="8" height="8" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l5 5M7 2l-5 5" />
          </svg>
        </button>
      ) : null}
    </Tag>
  );
}
