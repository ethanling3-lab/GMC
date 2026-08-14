// Unread count pill for a conversation row.
//
// Cinnabar (the editorial blue in this palette, despite the variable name —
// see the palette note in project memory) rather than the usual red: this is
// "someone is waiting", not "something is broken". The inbox already uses red
// tones for failed sends, and the two must not read the same at a glance.
//
// Caps at 99+ so a long-neglected thread cannot widen the row and squeeze the
// preview text, which shares the line.
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      className="flex-none inline-flex items-center justify-center
                 min-w-[18px] h-[18px] px-1.5
                 rounded-[var(--radius-pill)]
                 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                 text-[10px] font-semibold tabular-nums leading-none
                 shadow-[var(--shadow-paper-1)]"
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
    >
      {label}
    </span>
  );
}
