"use client";

// ShapeInspector — Pass 4 Miro chrome.
//
// Slide-in floating panel anchored to the right edge of the canvas.
// Renders only when a shape is selected; idle = nothing on screen.
// Closing the panel (✕ or click empty canvas) clears selection.

import {
  PROGRAMME_ABBREV,
  SHAPE_LABEL_CN,
  SHAPE_LABEL_EN,
  type GroupRoster,
  type Shape,
  type SquareSeats,
} from "./types";

type Props = {
  shape: Shape | null;
  roster: GroupRoster | null;
  allGroups: GroupRoster[];
  seatingMode: "tables" | "cushions";
  canEdit: boolean;
  // Total selection count. 0 = idle (no panel), 1 = single (full inspector
  // for `shape`), >1 = multi (compact summary with batch ops).
  selectedCount: number;
  onUpdate: (patch: Partial<Shape>) => void;
  onDelete: () => void;
  onBumpZ: (dir: "up" | "down") => void;
  onDeleteAll: () => void;
  onToggleLockAll: () => void;
  onDuplicateAll: () => void;
  onClose: () => void;
};

const GROUP_CLASS_LABEL: Record<string, string> = {
  strategic: "特级 · Strategic",
  key: "重点 · Key",
  growth: "成长 · Growth",
  maintenance: "维护 · Maintenance",
};

export function ShapeInspector({
  shape,
  roster,
  allGroups,
  seatingMode,
  canEdit,
  selectedCount,
  onUpdate,
  onDelete,
  onBumpZ,
  onDeleteAll,
  onToggleLockAll,
  onDuplicateAll,
  onClose,
}: Props) {
  // Idle (no selection) → render nothing per Pass 4 decision.
  if (selectedCount === 0) return null;

  // Multi-select → compact summary + batch ops only.
  if (selectedCount > 1) {
    return (
      <MultiSelectInspector
        count={selectedCount}
        canEdit={canEdit}
        onDeleteAll={onDeleteAll}
        onToggleLockAll={onToggleLockAll}
        onDuplicateAll={onDuplicateAll}
        onClose={onClose}
      />
    );
  }

  // Single select with no shape resolved (timing race) → render nothing.
  if (!shape) return null;

  return (
    <aside
      className="gmc-print-hide absolute right-3 top-3 bottom-3 w-[300px] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] overflow-hidden h-auto z-10 flex flex-col"
    >
      <div className="px-3 py-2.5 border-b border-[var(--paper-shadow)]/70 flex items-center justify-between gap-2 shrink-0">
        <div className="text-[9.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          Inspector · 检视
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {SHAPE_LABEL_EN[shape.kind]}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M3 3 L 9 9 M9 3 L 3 9" />
            </svg>
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
        <div className="p-3 flex flex-col gap-4">
          <KindHeader shape={shape} />
          {(shape.kind === "round_table" || shape.kind === "square_table")
            && seatingMode === "tables" ? (
            <AssignGroupField
              shape={shape}
              roster={roster}
              allGroups={allGroups}
              disabled={!canEdit || shape.locked}
              onChange={(groupId) => onUpdate({ group_id: groupId })}
            />
          ) : null}
          {shape.kind === "round_table" ? (
            <SeatCountField
              value={shape.seat_count ?? 0}
              min={4}
              max={14}
              disabled={!canEdit || shape.locked}
              onChange={(n) => onUpdate({ seat_count: n })}
            />
          ) : null}
          {shape.kind === "square_table" ? (
            <SquareSeatsField
              value={
                shape.seats_per_side ?? {
                  top: 3,
                  right: 3,
                  bottom: 3,
                  head: 1,
                }
              }
              disabled={!canEdit || shape.locked}
              onChange={(seats, total) =>
                onUpdate({
                  seats_per_side: seats,
                  seat_count: total,
                })
              }
            />
          ) : null}
          <LabelField
            valueEn={shape.label_en ?? ""}
            valueCn={shape.label_cn ?? ""}
            disabled={!canEdit || shape.locked}
            onChangeEn={(v) =>
              onUpdate({ label_en: v.length > 0 ? v : null })
            }
            onChangeCn={(v) =>
              onUpdate({ label_cn: v.length > 0 ? v : null })
            }
          />
          <RotationField
            value={shape.rotation_deg}
            disabled={!canEdit || shape.locked}
            onChange={(v) => onUpdate({ rotation_deg: v })}
          />
          <PositionField shape={shape} />
          <div className="flex flex-col gap-2 pt-1">
            <LockToggle
              locked={shape.locked}
              disabled={!canEdit}
              onToggle={() => onUpdate({ locked: !shape.locked })}
            />
            <ZOrderField
              z={shape.z_order}
              disabled={!canEdit || shape.locked}
              onBump={onBumpZ}
            />
            <DeleteButton
              disabled={!canEdit}
              onConfirm={onDelete}
              kindLabel={SHAPE_LABEL_EN[shape.kind]}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function KindHeader({ shape }: { shape: Shape }) {
  return (
    <div className="flex items-baseline justify-between gap-2 -mt-1">
      <h2 className="font-display text-[18px] leading-tight tracking-[-0.01em] text-[var(--ink)]">
        {SHAPE_LABEL_EN[shape.kind]}
      </h2>
      <span className="text-[11.5px] tracking-[0.04em] text-[var(--ink-faint)]">
        {SHAPE_LABEL_CN[shape.kind]}
      </span>
    </div>
  );
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          {label}
        </span>
        {hint ? (
          <span className="text-[10px] tracking-[0.04em] text-[var(--ink-faint)]">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SeatCountField({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <FieldShell label="Seats · 座位" hint={`${min}–${max}`}>
      <div className="flex items-stretch border border-[var(--paper-shadow)] rounded-[var(--radius-sm)] overflow-hidden">
        <Stepper
          dir="-"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        />
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.max(min, Math.min(max, Math.round(n))));
          }}
          className="flex-1 min-w-0 bg-[var(--paper-warm)] text-center text-[13px] tabular-nums focus:outline-none focus:bg-[var(--cinnabar-wash)] disabled:opacity-50"
        />
        <Stepper
          dir="+"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        />
      </div>
    </FieldShell>
  );
}

function SquareSeatsField({
  value,
  disabled,
  onChange,
}: {
  value: SquareSeats;
  disabled: boolean;
  onChange: (seats: SquareSeats, total: number) => void;
}) {
  function set(part: keyof SquareSeats, n: number) {
    const next = { ...value, [part]: Math.max(0, Math.min(8, n)) };
    const total = next.top + next.right + next.bottom + next.head;
    onChange(next, total);
  }
  const total = value.top + value.right + value.bottom + value.head;
  return (
    <FieldShell label="Seats · 座位 (per side)" hint={`Σ ${total}`}>
      <div className="grid grid-cols-2 gap-2">
        <SmallStepper
          label="Top · 上"
          value={value.top}
          disabled={disabled}
          onChange={(n) => set("top", n)}
        />
        <SmallStepper
          label="Right · 右"
          value={value.right}
          disabled={disabled}
          onChange={(n) => set("right", n)}
        />
        <SmallStepper
          label="Bottom · 下"
          value={value.bottom}
          disabled={disabled}
          onChange={(n) => set("bottom", n)}
        />
        <SmallStepper
          label="Head · 主"
          value={value.head}
          disabled={disabled}
          onChange={(n) => set("head", n)}
        />
      </div>
    </FieldShell>
  );
}

function SmallStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <div className="flex items-stretch border border-[var(--paper-shadow)] rounded-[var(--radius-sm)] overflow-hidden">
        <Stepper
          dir="-"
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
        />
        <span className="flex-1 min-w-0 px-1 py-1 text-center text-[13px] tabular-nums bg-[var(--paper-warm)]">
          {value}
        </span>
        <Stepper
          dir="+"
          disabled={disabled || value >= 8}
          onClick={() => onChange(value + 1)}
        />
      </div>
    </div>
  );
}

function Stepper({
  dir,
  disabled,
  onClick,
}: {
  dir: "+" | "-";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 text-[14px] leading-none text-[var(--ink-soft)] bg-[var(--paper-warm)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] disabled:opacity-40 disabled:hover:bg-[var(--paper-warm)] focus-visible:shadow-[var(--shadow-focus)] transition-colors"
    >
      {dir}
    </button>
  );
}

function LabelField({
  valueEn,
  valueCn,
  disabled,
  onChangeEn,
  onChangeCn,
}: {
  valueEn: string;
  valueCn: string;
  disabled: boolean;
  onChangeEn: (v: string) => void;
  onChangeCn: (v: string) => void;
}) {
  return (
    <FieldShell label="Label · 标签">
      <input
        type="text"
        value={valueEn}
        disabled={disabled}
        onChange={(e) => onChangeEn(e.target.value.slice(0, 80))}
        placeholder="English"
        className="px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)]/50 focus:shadow-[var(--shadow-focus)] disabled:opacity-50"
      />
      <input
        type="text"
        value={valueCn}
        disabled={disabled}
        onChange={(e) => onChangeCn(e.target.value.slice(0, 80))}
        placeholder="中文"
        className="px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)]/50 focus:shadow-[var(--shadow-focus)] disabled:opacity-50"
      />
    </FieldShell>
  );
}

function RotationField({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  // Normalize input to [-180, 180].
  const normalized = ((value + 540) % 360) - 180;
  return (
    <FieldShell label="Rotation · 旋转" hint={`${Math.round(normalized)}°`}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(normalized)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--cinnabar)] disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || normalized === 0}
          onClick={() => onChange(0)}
          className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] disabled:opacity-40 disabled:hover:text-[var(--ink-faint)] transition-colors"
        >
          Reset
        </button>
      </div>
    </FieldShell>
  );
}

function PositionField({ shape }: { shape: Shape }) {
  return (
    <FieldShell label="Position · 位置" hint="user-space">
      <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums text-[var(--ink-soft)]">
        <ReadOnly label="x" value={shape.x_pct.toFixed(1)} />
        <ReadOnly label="y" value={shape.y_pct.toFixed(1)} />
        <ReadOnly label="w" value={shape.width_pct.toFixed(1)} />
        <ReadOnly label="h" value={shape.height_pct.toFixed(1)} />
      </div>
    </FieldShell>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--paper-shadow)]/60">
      <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="ml-auto">{value}</span>
    </div>
  );
}

function LockToggle({
  locked,
  disabled,
  onToggle,
}: {
  locked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-sm)] border text-[12px] transition-colors disabled:opacity-50
        ${
          locked
            ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30"
        }`}
    >
      <span className="inline-flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          {locked ? (
            <>
              <rect x="3" y="7" width="10" height="7" rx="1" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
            </>
          ) : (
            <>
              <rect x="3" y="7" width="10" height="7" rx="1" />
              <path d="M5 7V5a3 3 0 0 1 5.6-1.5" />
            </>
          )}
        </svg>
        {locked ? "Locked · 锁定" : "Lock · 锁定"}
      </span>
      <span className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {locked ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function ZOrderField({
  z,
  disabled,
  onBump,
}: {
  z: number;
  disabled: boolean;
  onBump: (dir: "up" | "down") => void;
}) {
  return (
    <FieldShell label="Stacking · 层级" hint={`z=${z}`}>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onBump("up")}
          className="px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30 hover:text-[var(--cinnabar-deep)] disabled:opacity-50 disabled:hover:border-[var(--paper-shadow)] transition-colors"
        >
          Bring forward
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onBump("down")}
          className="px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/30 hover:text-[var(--cinnabar-deep)] disabled:opacity-50 disabled:hover:border-[var(--paper-shadow)] transition-colors"
        >
          Send back
        </button>
      </div>
    </FieldShell>
  );
}

function DeleteButton({
  disabled,
  onConfirm,
  kindLabel,
}: {
  disabled: boolean;
  onConfirm: () => void;
  kindLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (
          typeof window !== "undefined"
          && window.confirm(`Delete this ${kindLabel.toLowerCase()}?`)
        ) {
          onConfirm();
        }
      }}
      className="mt-1 px-3 py-2 rounded-[var(--radius-sm)] border text-[12px] transition-colors disabled:opacity-50"
      style={{
        borderColor: "rgba(185, 28, 28, 0.35)",
        background: "rgba(185, 28, 28, 0.04)",
        color: "#B91C1C",
      }}
    >
      Delete shape · 删除
    </button>
  );
}

function AssignGroupField({
  shape,
  roster,
  allGroups,
  disabled,
  onChange,
}: {
  shape: Shape;
  roster: GroupRoster | null;
  allGroups: GroupRoster[];
  disabled: boolean;
  onChange: (groupId: string | null) => void;
}) {
  const memberCount = roster?.members.length ?? 0;
  const seatCount = shape.seat_count ?? 0;
  const overflow = roster ? Math.max(0, memberCount - seatCount) : 0;
  const empty = roster ? Math.max(0, seatCount - memberCount) : 0;

  return (
    <FieldShell label="Assign group · 分组" hint={roster ? `${memberCount} pax` : "—"}>
      <div className="relative">
        <select
          value={shape.group_id ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.length > 0 ? v : null);
          }}
          className="w-full appearance-none px-2.5 py-1.5 pr-8 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)]/50 focus:shadow-[var(--shadow-focus)] disabled:opacity-50"
        >
          <option value="">— None · 未分配 —</option>
          {allGroups.map((g) => {
            const cls = g.group_class
              ? GROUP_CLASS_LABEL[g.group_class] ?? g.group_class
              : null;
            const name =
              g.name_en && g.name_cn
                ? `${g.name_cn} · ${g.name_en}`
                : g.name_en ?? g.name_cn ?? `Table ${g.group_no}`;
            return (
              <option key={g.id} value={g.id}>
                {`#${g.group_no} · ${name} · ${g.members.length} pax${cls ? ` · ${cls}` : ""}`}
              </option>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]">
          ▾
        </span>
      </div>
      {roster ? (
        <div className="mt-1 flex flex-col gap-1.5 px-2 py-2 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--paper-shadow)]/60">
          <div className="flex items-baseline justify-between gap-2 text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            <span>Roster preview</span>
            {overflow > 0 ? (
              <span style={{ color: "#B45309" }}>+{overflow} won't fit</span>
            ) : empty > 0 ? (
              <span className="text-[var(--ink-mute)]">{empty} empty</span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-0.5 text-[11.5px]">
            {roster.members.slice(0, Math.max(seatCount, 6)).map((m, idx) => {
              const tone =
                m.role === "zu_zhang"
                  ? { bg: "#FEE2E2", fg: "#991B1B" }
                  : m.role === "fu_zu_zhang"
                  ? { bg: "var(--cinnabar-wash)", fg: "var(--cinnabar-deep)" }
                  : m.role === "pai_zhang"
                  ? { bg: "var(--gold-soft)", fg: "var(--ink-soft)" }
                  : { bg: "var(--paper-warm)", fg: "var(--ink-soft)" };
              // CN preferred, EN fallback for non-Chinese names.
              const name =
                m.name_cn ?? m.name_en ?? "—";
              const rolePill =
                m.role === "zu_zhang"
                  ? "组长"
                  : m.role === "fu_zu_zhang"
                  ? "副"
                  : m.role === "pai_zhang"
                  ? "排"
                  : null;
              const programmeChar = m.programme_tier
                ? PROGRAMME_ABBREV[m.programme_tier]
                : null;
              return (
                <li
                  key={m.participant_id}
                  className="flex items-baseline gap-1.5 px-1.5 py-0.5 rounded-[3px]"
                  style={{ background: idx >= seatCount ? "rgba(180, 83, 9, 0.06)" : tone.bg }}
                >
                  <span
                    className="font-mono text-[10px] tabular-nums shrink-0"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {idx + 1}
                  </span>
                  {rolePill ? (
                    <span
                      className="text-[9.5px] tracking-[0.16em] uppercase shrink-0"
                      style={{ color: tone.fg }}
                    >
                      {rolePill}
                    </span>
                  ) : null}
                  <span
                    className="font-mono text-[9.5px] shrink-0"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {m.region_id ?? "—"}
                  </span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: tone.fg }}>
                    {name}
                  </span>
                  {!m.is_old_student ? (
                    <span
                      className="text-[9.5px] tracking-[0.16em] shrink-0"
                      style={{ color: "var(--gold-deep, #92580B)" }}
                      title="New student · 新生"
                    >
                      新
                    </span>
                  ) : null}
                  {programmeChar ? (
                    <span
                      className="text-[9.5px] tracking-[0.16em] shrink-0"
                      style={{ color: "var(--ink-mute)" }}
                      title={`Programme · ${m.programme_tier}`}
                    >
                      {programmeChar}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {roster.members.length > Math.max(seatCount, 6) ? (
              <li className="text-[10.5px] text-[var(--ink-faint)] px-1.5 pt-0.5">
                + {roster.members.length - Math.max(seatCount, 6)} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <p className="text-[10.5px] text-[var(--ink-faint)] mt-0.5 leading-[1.5]">
          Pick a generated group to drop its roster onto this table. Members
          fill in role order: 组长 first, then 副组长, then participants.
        </p>
      )}
    </FieldShell>
  );
}

// Compact panel shown when N>1 shapes are selected. The single-select
// inspector renders too much detail to be useful for batch operations, so
// this surface restricts to the actions that genuinely apply across the
// whole set: delete, lock toggle, duplicate. Per-shape edits stay one
// shape at a time.
function MultiSelectInspector({
  count,
  canEdit,
  onDeleteAll,
  onToggleLockAll,
  onDuplicateAll,
  onClose,
}: {
  count: number;
  canEdit: boolean;
  onDeleteAll: () => void;
  onToggleLockAll: () => void;
  onDuplicateAll: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="gmc-print-hide absolute right-3 top-3 w-[300px] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] overflow-hidden z-10"
    >
      <div className="px-3 py-2.5 border-b border-[var(--paper-shadow)]/70 flex items-center justify-between gap-2">
        <div className="text-[9.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          Inspector · 检视
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] tabular-nums">
            {count} selected
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M3 3 L 9 9 M9 3 L 3 9" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-3">
        <p className="text-[11px] leading-[1.55] text-[var(--ink-soft)]">
          <span className="font-display text-[15px] tabular-nums text-[var(--ink)]">{count}</span>
          <span className="ml-1.5">shapes selected. Use the keyboard or
          buttons below to act on them as a group.</span>
        </p>

        <div className="flex flex-col gap-1.5 text-[10.5px] tracking-[0.04em] text-[var(--ink-soft)]">
          <KbdHint k="↑↓←→" label="Nudge · Shift = ×10" />
          <KbdHint k="⌘D" label="Duplicate" />
          <KbdHint k="L" label="Lock / unlock" />
          <KbdHint k="⌫" label="Delete" />
          <KbdHint k="⌘A" label="Select all" />
          <KbdHint k="⌘Z" label="Undo · Shift = redo" />
        </div>

        {canEdit ? (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              type="button"
              onClick={onDuplicateAll}
              className="px-2 h-8 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.04em] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/50 hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-colors"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={onToggleLockAll}
              className="px-2 h-8 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.04em] text-[var(--ink-soft)] hover:border-[var(--ink)]/50 hover:text-[var(--ink)] transition-colors"
            >
              Lock / unlock
            </button>
            <button
              type="button"
              onClick={onDeleteAll}
              className="col-span-2 px-2 h-8 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[11px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper)] transition-colors"
            >
              Delete {count} shapes
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function KbdHint({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 rounded-[var(--radius-sm,4px)] border border-[var(--paper-shadow)] bg-[var(--paper)] font-mono text-[10px] tracking-normal text-[var(--ink-soft)]">
        {k}
      </kbd>
      <span className="text-[var(--ink-faint)]">{label}</span>
    </div>
  );
}

