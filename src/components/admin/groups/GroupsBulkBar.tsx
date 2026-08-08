"use client";

import { useState } from "react";

// Phase 4 — the action surface for a multi-selection.
//
// Fixed to the bottom of the viewport because a selection routinely spans
// group cards that are screens apart: the admin ticks people in #3 and #21,
// and the controls have to be wherever they finish, not pinned to one card.
//
// Swap is a distinct action rather than "two moves" because two independent
// moves transiently bust both group sizes and lose you the exchange if the
// second one fails. It unlocks only for exactly two people sitting in two
// different groups — the only shape the operation is defined for.

type Props = {
  count: number;
  // Group numbers the selection spans, ascending.
  groupNos: number[];
  // Every group number in the event, for the move target picker.
  allGroupNos: number[];
  // group_no → the label to display for it. Wire values stay group_no (that's
  // what to_group_no resolves by); only the text switches to table numbers.
  labelOfGroupNo: (groupNo: number) => string;
  canSwap: boolean;
  // Why swap is unavailable, when it is — shown as the button's tooltip.
  swapHint: string;
  busy: boolean;
  onMove: (toGroupNo: number) => void;
  onUnassign: () => void;
  onSwap: () => void;
  onClear: () => void;
};

export function GroupsBulkBar({
  count,
  groupNos,
  allGroupNos,
  labelOfGroupNo,
  canSwap,
  swapHint,
  busy,
  onMove,
  onUnassign,
  onSwap,
  onClear,
}: Props) {
  const [confirmingUnassign, setConfirmingUnassign] = useState(false);

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[65] max-w-[94vw] flex items-center gap-3 flex-wrap rounded-[var(--radius-md)] border border-[var(--ink)]/20 bg-[var(--paper-warm)] px-4 py-2.5 shadow-[var(--shadow-elevated)]"
    >
      <span className="inline-flex items-baseline gap-2 text-[12.5px] text-[var(--ink)]">
        <span className="tabular-nums font-medium">{count}</span>
        <span className="text-[var(--ink-mute)]">selected · 已选</span>
        {groupNos.length > 0 ? (
          <span className="text-[11px] text-[var(--ink-faint)]">
            {groupNos.length === 1
              ? labelOfGroupNo(groupNos[0])
              : `across ${groupNos.length} groups`}
          </span>
        ) : null}
      </span>

      <span className="w-px h-5 bg-[var(--paper-shadow)]" aria-hidden="true" />

      <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--ink-soft)]">
        Move to · 移至
        <select
          value=""
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) onMove(n);
            e.currentTarget.value = "";
          }}
          className="h-[26px] text-[11.5px] rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--paper-shadow)] px-1.5 text-[var(--ink)] disabled:opacity-50"
          aria-label="Move selected to group"
        >
          <option value="" disabled>
            #…
          </option>
          {allGroupNos.map((n) => (
            <option key={n} value={n}>
              {labelOfGroupNo(n)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={!canSwap || busy}
        onClick={onSwap}
        title={canSwap ? "Exchange the two selected members" : swapHint}
        className="inline-flex items-center h-[26px] px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] tracking-[0.04em] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] disabled:opacity-40 disabled:hover:border-[var(--paper-shadow)] disabled:hover:bg-[var(--paper)] disabled:hover:text-[var(--ink)] transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
      >
        ⇄ Swap · 对调
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (confirmingUnassign) {
            onUnassign();
            setConfirmingUnassign(false);
          } else {
            setConfirmingUnassign(true);
            // Disarm on its own so a stray first click can't sit there
            // primed while the admin does something else.
            setTimeout(() => setConfirmingUnassign(false), 4000);
          }
        }}
        className={`inline-flex items-center h-[26px] px-3 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em] disabled:opacity-40 transition-[background-color,color,border-color] duration-[var(--dur-fast)] ${
          confirmingUnassign
            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)] ring-1 ring-[var(--cinnabar)]/40"
            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]"
        }`}
      >
        {confirmingUnassign
          ? `Click again to unassign ${count}`
          : "Unassign · 移出"}
      </button>

      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="text-[11px] tracking-[0.04em] text-[var(--ink-faint)] hover:text-[var(--ink)] disabled:opacity-40 transition-colors"
      >
        Clear · 清除
      </button>
    </div>
  );
}
