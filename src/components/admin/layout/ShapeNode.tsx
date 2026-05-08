"use client";

// ShapeNode — pure-render component for one floor-plan shape.
//
// Wrapped in React.memo at module export so pan/zoom-induced parent
// re-renders skip ShapeNode reconciliation when a shape's own props are
// stable. With 24+ tables × 30+ children each, this is the difference
// between React reconciling 700+ nodes per frame vs. zero during pan.

import { memo } from "react";
//
// Geometry comes from the parent. Pointer events are emitted upward via
// `onPointerDownHandle(e, handle)`; the parent's drag state machine
// translates those into shape geometry updates.
//
// Pass 3: when `roster` is set the shape becomes a *named* table — center
// label shows `Group N · 组N` (or the group's bilingual name when set), and
// each seat carries the assigned participant's bilingual name (or region_id
// when `revealNames` is false). Role-tinted fills: 组长 cinnabar,
// 副组长 gold. Empty seats render gray with no label.

import type { ReactNode } from "react";
import type { DragHandle } from "./FloorPlanCanvas";
import {
  PROGRAMME_ABBREV,
  type GroupRoster,
  type GroupRosterMember,
  type Shape,
} from "./types";

// Inline color tokens for role-tinted seats. Pass-3 used cinnabar for 组长
// and gold for 副 — Pass 4+ tightens to: 组长 = red, 副组长 = blue.
const SEAT_LEADER_RED_FILL = "#FECACA";
const SEAT_LEADER_RED_STROKE = "#DC2626";
const SEAT_LEADER_RED_TEXT = "#991B1B";

// Round a float to 4 decimal places (way more than SVG needs visually).
// Prevents SSR/CSR hydration mismatches where React's number-to-string
// serializer truncates differently between server and client (e.g., the
// server shipped y="21.33260795587004" but the client's prop value
// stringifies as y="21.332607955870042"). 4dp round-trips cleanly.
function r(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type Props = {
  shape: Shape;
  roster: GroupRoster | null;
  revealNames: boolean;
  selected: boolean;
  canEdit: boolean;
  // Pointer down handler — receives the shape id as the third arg so the
  // parent can pass a SINGLE stable callback to every ShapeNode (React.memo
  // would otherwise see a fresh inline arrow on every render and re-render
  // every shape on every pan/zoom).
  onPointerDownHandle: (
    e: React.PointerEvent,
    handle: DragHandle,
    shapeId: string,
  ) => void;
  showResizeHandles: boolean;
  showRotateHandle: boolean;
};

export const ShapeNode = memo(ShapeNodeInner);

function ShapeNodeInner({
  shape,
  roster,
  revealNames,
  selected,
  canEdit,
  onPointerDownHandle,
  showResizeHandles,
  showRotateHandle,
}: Props) {
  const cx = r(shape.x_pct + shape.width_pct / 2);
  const cy = r(shape.y_pct + shape.height_pct / 2);
  const transform = `rotate(${r(shape.rotation_deg)} ${cx} ${cy})`;

  const onBodyDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    // Locked shapes still propagate so admin can select + unlock them via
    // the inspector. The parent's startDrag respects the lock and selects
    // without entering drag state.
    onPointerDownHandle(e, "body", shape.id);
  };

  return (
    <g transform={transform} data-shape-id={shape.id}>
      <g
        onPointerDown={onBodyDown}
        style={{ cursor: canEdit && !shape.locked ? "grab" : "default" }}
      >
        <ShapeBody
          shape={shape}
          roster={roster}
          revealNames={revealNames}
        />
      </g>

      {selected ? (
        <>
          <rect
            x={r(shape.x_pct)}
            y={r(shape.y_pct)}
            width={r(shape.width_pct)}
            height={r(shape.height_pct)}
            fill="none"
            stroke="var(--cinnabar)"
            strokeWidth="0.18"
            strokeDasharray="0.7 0.5"
            pointerEvents="none"
          />
          {showResizeHandles && canEdit && !shape.locked ? (
            <>
              <Handle
                x={r(shape.x_pct)}
                y={r(shape.y_pct)}
                onDown={(e) => onPointerDownHandle(e, "tl", shape.id)}
                cursor="nwse-resize"
              />
              <Handle
                x={r(shape.x_pct + shape.width_pct)}
                y={r(shape.y_pct)}
                onDown={(e) => onPointerDownHandle(e, "tr", shape.id)}
                cursor="nesw-resize"
              />
              <Handle
                x={r(shape.x_pct)}
                y={r(shape.y_pct + shape.height_pct)}
                onDown={(e) => onPointerDownHandle(e, "bl", shape.id)}
                cursor="nesw-resize"
              />
              <Handle
                x={r(shape.x_pct + shape.width_pct)}
                y={r(shape.y_pct + shape.height_pct)}
                onDown={(e) => onPointerDownHandle(e, "br", shape.id)}
                cursor="nwse-resize"
              />
            </>
          ) : null}
          {showRotateHandle && canEdit && !shape.locked ? (
            <RotateHandle
              cx={cx}
              top={r(shape.y_pct)}
              onDown={(e) => onPointerDownHandle(e, "rotate", shape.id)}
            />
          ) : null}
          {shape.locked ? (
            <text
              x={cx}
              y={r(shape.y_pct - 0.6)}
              fontSize="1.6"
              textAnchor="middle"
              fill="var(--ink-faint)"
              fontFamily="var(--font-body), sans-serif"
              pointerEvents="none"
            >
              locked
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// Single-line label: CN preferred, EN fallback for non-Chinese names.
// Region-IDs mode (revealNames=false) overrides everything.
function formatMemberLabel(
  member: GroupRosterMember,
  reveal: boolean,
): { name: string | null } {
  if (!reveal) {
    return { name: member.region_id ?? "—" };
  }
  return {
    name:
      member.name_cn
      ?? member.name_en
      ?? member.region_id
      ?? "—",
  };
}

function memberSeatTone(role: GroupRosterMember["role"] | undefined): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  rolePill: string | null;
  rolePillColor: string;
} {
  if (role === "zu_zhang") {
    return {
      fill: SEAT_LEADER_RED_FILL,
      stroke: SEAT_LEADER_RED_STROKE,
      strokeWidth: 0.16,
      rolePill: "组长",
      rolePillColor: SEAT_LEADER_RED_TEXT,
    };
  }
  if (role === "fu_zu_zhang") {
    return {
      fill: "var(--cinnabar-soft)",
      stroke: "var(--cinnabar)",
      strokeWidth: 0.14,
      rolePill: "副",
      rolePillColor: "var(--cinnabar-deep)",
    };
  }
  if (role === "pai_zhang") {
    return {
      fill: "var(--gold-soft)",
      stroke: "var(--gold)",
      strokeWidth: 0.14,
      rolePill: "排长",
      rolePillColor: "var(--ink-soft)",
    };
  }
  if (role === "participant") {
    return {
      fill: "var(--paper-deep)",
      stroke: "var(--ink-soft)",
      strokeWidth: 0.1,
      rolePill: null,
      rolePillColor: "var(--ink-soft)",
    };
  }
  // Empty seat.
  return {
    fill: "var(--paper)",
    stroke: "var(--paper-shadow)",
    strokeWidth: 0.1,
    rolePill: null,
    rolePillColor: "var(--ink-faint)",
  };
}

// Render-side helper — flag chips line under a name. Strings only; the
// caller decides positioning + sizing.
function memberFlags(member: GroupRosterMember): string[] {
  const out: string[] = [];
  if (!member.is_old_student) out.push("新");
  if (member.programme_tier) {
    out.push(PROGRAMME_ABBREV[member.programme_tier]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape body renderers.
// ---------------------------------------------------------------------------

function ShapeBody({
  shape,
  roster,
  revealNames,
}: {
  shape: Shape;
  roster: GroupRoster | null;
  revealNames: boolean;
}) {
  const x = r(shape.x_pct);
  const y = r(shape.y_pct);
  const w = r(shape.width_pct);
  const h = r(shape.height_pct);
  const cx = r(x + w / 2);
  const cy = r(y + h / 2);

  switch (shape.kind) {
    case "round_table": {
      const tableR = r(Math.min(w, h) / 2);
      const seats = shape.seat_count ?? 0;
      return (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={tableR}
            fill="var(--paper-warm)"
            stroke="var(--ink-soft)"
            strokeWidth="0.18"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r(tableR * 0.55)}
            fill="none"
            stroke="var(--paper-shadow)"
            strokeWidth="0.1"
          />
          <SeatsAroundCircle
            cx={cx}
            cy={cy}
            r={tableR}
            count={seats}
            members={roster?.members ?? []}
            revealNames={revealNames}
          />
          <CenterTableLabel
            cx={cx}
            cy={cy}
            size={r(Math.min(w, h))}
            roster={roster}
            fallbackPrimary={shape.label_en ?? "Round"}
            fallbackSecondary={
              shape.label_cn ?? (seats ? `${seats} 座` : null)
            }
          />
        </>
      );
    }
    case "square_table": {
      const seats = shape.seats_per_side ?? {
        top: 3,
        right: 3,
        bottom: 3,
        head: 1,
      };
      return (
        <>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={0.4}
            ry={0.4}
            fill="var(--paper-warm)"
            stroke="var(--ink-soft)"
            strokeWidth="0.18"
          />
          <SeatsAroundSquare
            x={x}
            y={y}
            w={w}
            h={h}
            seats={seats}
            members={roster?.members ?? []}
            revealNames={revealNames}
          />
          <CenterTableLabel
            cx={cx}
            cy={cy}
            size={Math.min(w, h)}
            roster={roster}
            fallbackPrimary={shape.label_en ?? "Square"}
            fallbackSecondary={
              shape.label_cn ?? (shape.seat_count ? `${shape.seat_count} 座` : null)
            }
          />
        </>
      );
    }
    case "cushion": {
      const cushionR = r(Math.min(w, h) / 2);
      return (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={cushionR}
            fill="var(--cinnabar-soft)"
            stroke="var(--cinnabar-deep)"
            strokeWidth="0.12"
            opacity={0.85}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r(cushionR * 0.5)}
            fill="var(--cinnabar)"
            opacity={0.16}
          />
        </>
      );
    }
    case "stage": {
      return (
        <>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={0.6}
            ry={0.6}
            fill="var(--gold-soft)"
            stroke="var(--gold)"
            strokeWidth="0.2"
          />
          <CenterLabel
            cx={cx}
            cy={cy}
            primary={shape.label_en ?? "Stage"}
            secondary={shape.label_cn ?? "舞台"}
            size={Math.min(w, h)}
            tone="gold"
          />
        </>
      );
    }
    case "podium": {
      const xb = r(x + w * 0.15);
      const xt = r(x + w * 0.3);
      const xt2 = r(x + w * 0.7);
      const xb2 = r(x + w * 0.85);
      const yb = r(y + h);
      const path = `M ${xb} ${yb} L ${xb2} ${yb} L ${xt2} ${y} L ${xt} ${y} Z`;
      return (
        <>
          <path
            d={path}
            fill="var(--gold-soft)"
            stroke="var(--gold)"
            strokeWidth="0.2"
          />
          <CenterLabel
            cx={cx}
            cy={cy}
            primary={shape.label_en ?? "Podium"}
            secondary={shape.label_cn ?? "讲台"}
            size={r(Math.min(w, h))}
            tone="gold"
          />
        </>
      );
    }
    case "text_label": {
      return (
        <>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="var(--paper-shadow)"
            strokeWidth="0.08"
            strokeDasharray="0.4 0.4"
          />
          <CenterLabel
            cx={cx}
            cy={cy}
            primary={shape.label_en ?? "Label"}
            secondary={shape.label_cn}
            size={Math.min(w, h)}
            tone="ink"
            invisibleBackground
          />
        </>
      );
    }
    case "door": {
      const radius = r(Math.min(w, h * 4));
      const yh = r(y + h);
      const xr = r(x + radius);
      const yhMinus = r(y + h - radius);
      return (
        <g>
          <path
            d={`M ${x} ${yh} A ${radius} ${radius} 0 0 1 ${xr} ${yhMinus}`}
            fill="none"
            stroke="var(--ink-soft)"
            strokeWidth="0.16"
          />
          <line
            x1={x}
            y1={yh}
            x2={xr}
            y2={yh}
            stroke="var(--ink-soft)"
            strokeWidth="0.16"
            opacity={0.5}
          />
          <line
            x1={x}
            y1={r(yh - 0.4)}
            x2={x}
            y2={r(yh + 0.4)}
            stroke="var(--ink-soft)"
            strokeWidth="0.3"
          />
        </g>
      );
    }
    case "wall": {
      const ymid = r(y + h / 2);
      return (
        <line
          x1={x}
          y1={ymid}
          x2={r(x + w)}
          y2={ymid}
          stroke="var(--ink-soft)"
          strokeWidth={r(Math.max(0.4, h))}
          strokeLinecap="round"
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Seats — round table.
// ---------------------------------------------------------------------------

function SeatsAroundCircle({
  cx,
  cy,
  r: tableR,
  count,
  members,
  revealNames,
}: {
  cx: number;
  cy: number;
  r: number;
  count: number;
  members: GroupRosterMember[];
  revealNames: boolean;
}) {
  if (!count || count <= 0) return null;
  const seatR = Math.max(0.55, tableR * 0.18);
  const ringR = tableR + seatR * 0.85;
  // Single radial position for the label cluster; name/flag stack in
  // screen-Y so seats on the table sides (3 / 9 o'clock) read as two
  // clean lines instead of overlapping horizontally.
  const labelR = ringR + seatR * 2.8;
  // Vertical line offsets relative to the label center.
  const nameDy = seatR * 0.55;
  const flagDy = seatR * 0.85;
  const out: ReactNode[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const sx = r(cx + ringR * Math.cos(angle));
    const sy = r(cy + ringR * Math.sin(angle));
    const member = members[i];
    const tone = memberSeatTone(member?.role);

    out.push(
      <circle
        key={`s-${i}`}
        cx={sx}
        cy={sy}
        r={r(seatR)}
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={tone.strokeWidth}
      />,
    );

    out.push(
      <text
        key={`n-${i}`}
        x={sx}
        y={r(sy + seatR * 0.04)}
        fontSize={r(seatR * 0.78)}
        fontFamily="var(--font-mono), monospace"
        fill="var(--ink-mute)"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {i + 1}
      </text>,
    );

    if (!member) continue;

    const label = formatMemberLabel(member, revealNames);
    const flags = revealNames ? memberFlags(member) : [];
    // Label cluster center (radial). Name above + flag below stack in
    // screen-Y so adjacent text rows always have clear vertical separation,
    // even for seats at 3 o'clock / 9 o'clock where the radial axis is
    // horizontal.
    const lx = r(cx + labelR * Math.cos(angle));
    const ly = cy + labelR * Math.sin(angle);

    // Seat fill color carries the role (red / blue) — no text pill.
    if (label.name) {
      out.push(
        <text
          key={`p-${i}`}
          x={lx}
          y={r(ly - nameDy)}
          fontSize={r(seatR * 1.15)}
          fontFamily="var(--font-cjk), var(--font-body), sans-serif"
          fontWeight={600}
          fill="var(--ink)"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label.name}
        </text>,
      );
    }
    if (flags.length > 0) {
      out.push(
        <text
          key={`f-${i}`}
          x={lx}
          y={r(ly + flagDy)}
          fontSize={r(seatR * 0.7)}
          fontFamily="var(--font-cjk), sans-serif"
          fill="var(--ink-faint)"
          textAnchor="middle"
          dominantBaseline="middle"
          letterSpacing="0.22em"
        >
          {flags.join(" ")}
        </text>,
      );
    }
  }
  return (
    <g className="gmc-seat-cluster" pointerEvents="none">
      {out}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Seats — square table.
// ---------------------------------------------------------------------------

function SeatsAroundSquare({
  x,
  y,
  w,
  h,
  seats,
  members,
  revealNames,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  seats: { top: number; right: number; bottom: number; head: number };
  members: GroupRosterMember[];
  revealNames: boolean;
}) {
  const seatSize = Math.min(w, h) * 0.18;
  const offset = seatSize * 0.7;
  const out: ReactNode[] = [];
  let memberIdx = 0;

  function pushSeat(
    key: string,
    sxIn: number,
    syIn: number,
    side: "top" | "right" | "bottom" | "head",
  ) {
    const sx = r(sxIn);
    const sy = r(syIn);
    const member = members[memberIdx];
    memberIdx += 1;
    const tone = memberSeatTone(member?.role);
    out.push(
      <rect
        key={key}
        x={r(sx - seatSize / 2)}
        y={r(sy - seatSize / 2)}
        width={r(seatSize)}
        height={r(seatSize)}
        rx={r(seatSize * 0.25)}
        ry={r(seatSize * 0.25)}
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={tone.strokeWidth}
      />,
    );
    out.push(
      <text
        key={`${key}-n`}
        x={sx}
        y={sy}
        fontSize={r(seatSize * 0.45)}
        fontFamily="var(--font-mono), monospace"
        fill="var(--ink-mute)"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {memberIdx}
      </text>,
    );
    if (!member) return;
    const label = formatMemberLabel(member, revealNames);
    const flags = revealNames ? memberFlags(member) : [];
    // Label cluster anchor — outside the seat per side. Name + flag stack
    // in screen-Y around this anchor regardless of which side the seat
    // sits on (matches the round-table layout).
    let lx = sx;
    let ly = sy;
    if (side === "top") {
      ly = sy - seatSize * 1.7;
    } else if (side === "bottom") {
      ly = sy + seatSize * 1.7;
    } else if (side === "right") {
      lx = sx + seatSize * 2.3;
    } else {
      lx = sx - seatSize * 2.3;
    }
    const nameDy = seatSize * 0.32;
    const flagDy = seatSize * 0.5;
    if (label.name) {
      out.push(
        <text
          key={`${key}-p`}
          x={r(lx)}
          y={r(ly - nameDy)}
          fontSize={r(seatSize * 0.62)}
          fontFamily="var(--font-cjk), var(--font-body), sans-serif"
          fontWeight={600}
          fill="var(--ink)"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label.name}
        </text>,
      );
    }
    if (flags.length > 0) {
      out.push(
        <text
          key={`${key}-f`}
          x={r(lx)}
          y={r(ly + flagDy)}
          fontSize={r(seatSize * 0.42)}
          fontFamily="var(--font-cjk), sans-serif"
          fill="var(--ink-faint)"
          textAnchor="middle"
          dominantBaseline="middle"
          letterSpacing="0.22em"
        >
          {flags.join(" ")}
        </text>,
      );
    }
  }

  for (let i = 0; i < seats.top; i++) {
    const t = (i + 1) / (seats.top + 1);
    pushSeat(`t-${i}`, x + w * t, y - offset, "top");
  }
  for (let i = 0; i < seats.right; i++) {
    const t = (i + 1) / (seats.right + 1);
    pushSeat(`r-${i}`, x + w + offset, y + h * t, "right");
  }
  for (let i = 0; i < seats.bottom; i++) {
    const t = (i + 1) / (seats.bottom + 1);
    pushSeat(`b-${i}`, x + w * t, y + h + offset, "bottom");
  }
  for (let i = 0; i < seats.head; i++) {
    const t = (i + 1) / (seats.head + 1);
    pushSeat(`h-${i}`, x - offset, y + h * t, "head");
  }

  return (
    <g className="gmc-seat-cluster" pointerEvents="none">
      {out}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Center labels.
// ---------------------------------------------------------------------------

function CenterTableLabel({
  cx,
  cy,
  size,
  roster,
  fallbackPrimary,
  fallbackSecondary,
}: {
  cx: number;
  cy: number;
  size: number;
  roster: GroupRoster | null;
  fallbackPrimary: string | null;
  fallbackSecondary: string | null;
}) {
  if (roster) {
    const eyebrowSize = r(Math.max(0.9, size * 0.1));
    const titleSize = r(Math.max(1.4, size * 0.18));
    const subSize = r(titleSize * 0.7);
    const titlePrimary =
      roster.name_en && roster.name_cn
        ? `${roster.name_cn}`
        : roster.name_en ?? roster.name_cn ?? `Table ${roster.group_no}`;
    const titleSecondary =
      roster.name_en && roster.name_cn
        ? roster.name_en
        : roster.name_en
        ? null
        : null;

    return (
      <g pointerEvents="none">
        <text
          x={cx}
          y={r(cy - titleSize * 0.55)}
          fontSize={eyebrowSize}
          fontFamily="var(--font-body), sans-serif"
          fill="var(--cinnabar-deep)"
          textAnchor="middle"
          dominantBaseline="middle"
          letterSpacing="0.18em"
        >
          {`GROUP ${roster.group_no} · 组 ${roster.group_no}`}
        </text>
        <text
          x={cx}
          y={r(cy + (titleSecondary ? -titleSize * 0.05 : titleSize * 0.25))}
          fontSize={titleSize}
          fontFamily="var(--font-display), serif"
          fill="var(--ink)"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {titlePrimary}
        </text>
        {titleSecondary ? (
          <text
            x={cx}
            y={r(cy + titleSize * 0.7)}
            fontSize={subSize}
            fontFamily="var(--font-body), sans-serif"
            fill="var(--ink-mute)"
            textAnchor="middle"
            dominantBaseline="middle"
            letterSpacing="0.04em"
          >
            {titleSecondary}
          </text>
        ) : null}
      </g>
    );
  }
  return (
    <CenterLabel
      cx={cx}
      cy={cy}
      primary={fallbackPrimary}
      secondary={fallbackSecondary}
      size={size}
    />
  );
}

function Handle({
  x,
  y,
  onDown,
  cursor,
}: {
  x: number;
  y: number;
  onDown: (e: React.PointerEvent) => void;
  cursor: string;
}) {
  const s = 1.4;
  return (
    <rect
      x={r(x - s / 2)}
      y={r(y - s / 2)}
      width={s}
      height={s}
      fill="var(--paper-warm)"
      stroke="var(--cinnabar)"
      strokeWidth="0.16"
      style={{ cursor }}
      onPointerDown={onDown}
    />
  );
}

function RotateHandle({
  cx,
  top,
  onDown,
}: {
  cx: number;
  top: number;
  onDown: (e: React.PointerEvent) => void;
}) {
  const lift = 3;
  const tip = r(top - lift);
  return (
    <g style={{ cursor: "alias" }}>
      <line
        x1={cx}
        y1={top}
        x2={cx}
        y2={tip}
        stroke="var(--cinnabar)"
        strokeWidth="0.16"
        pointerEvents="none"
      />
      <circle
        cx={cx}
        cy={tip}
        r="0.9"
        fill="var(--paper-warm)"
        stroke="var(--cinnabar)"
        strokeWidth="0.16"
        onPointerDown={onDown}
      />
    </g>
  );
}

function CenterLabel({
  cx,
  cy,
  primary,
  secondary,
  size,
  tone = "ink",
  invisibleBackground = false,
}: {
  cx: number;
  cy: number;
  primary: string | null;
  secondary: string | null;
  size: number;
  tone?: "ink" | "gold";
  invisibleBackground?: boolean;
}) {
  const fontSize = r(Math.max(1.2, size * 0.16));
  const subSize = r(fontSize * 0.78);
  const color = tone === "gold" ? "var(--ink-soft)" : "var(--ink)";
  const subColor = "var(--ink-faint)";
  return (
    <g pointerEvents="none">
      {primary ? (
        <text
          x={cx}
          y={r(cy + (secondary ? -subSize * 0.2 : fontSize * 0.35))}
          fontSize={fontSize}
          fontFamily="var(--font-display), serif"
          fill={color}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={invisibleBackground ? 0.95 : 1}
        >
          {primary}
        </text>
      ) : null}
      {secondary ? (
        <text
          x={cx}
          y={r(cy + fontSize * 0.85)}
          fontSize={subSize}
          fontFamily="var(--font-body), var(--font-cjk), sans-serif"
          fill={subColor}
          textAnchor="middle"
          dominantBaseline="middle"
          letterSpacing="0.04em"
        >
          {secondary}
        </text>
      ) : null}
    </g>
  );
}
