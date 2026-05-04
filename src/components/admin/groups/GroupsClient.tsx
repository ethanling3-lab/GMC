"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  GroupBuilderCushion,
  GroupBuilderGroup,
  GroupBuilderMember,
} from "@/lib/grouping/load-groups";
import {
  GROUP_CLASS_LABEL,
  GROWTH_DIMENSION_LABEL,
  STUDENT_QUALIFICATION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  requiredLeaderTiers,
} from "@/lib/grouping/types";
import type {
  GroupClass,
  GroupMemberRole,
  GrowthDimension,
  RosterShortfall,
  SeatingMode,
  ZuZhangTier,
} from "@/lib/grouping/types";

// Mode-aware client surface for the GroupBuilder. Table mode renders a
// stack of group cards with dnd-kit drag-drop reassign + role override
// menu + inline rationale edit. Cushion mode renders a flat ranked
// preview list (the actual seat-swap UI lands in M6.6 floor-plan editor).

type Props = {
  eventId: string;
  mode: SeatingMode;
  groupSizeMin: number;
  groupSizeMax: number;
  enrolmentCount: number;
  groups: GroupBuilderGroup[];
  cushions: GroupBuilderCushion[];
  canEdit: boolean;
  canGenerate: boolean;
  // Pass 1 visibility surfaces.
  rosterShortfalls: RosterShortfall[];
  memberCountByClass: Record<GroupClass, number>;
  kByClass: Record<GroupClass, number>;
};

export function GroupsClient(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Single open role-popover across the whole page. Click another row
  // → previous popover closes. Click anywhere outside a row → all close.
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  // Single open detail row across the page (mirrors role popover).
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMemberId) return;
    function onPointer(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-member-row]") || target.closest("[data-role-popover]")) {
        return;
      }
      setOpenMemberId(null);
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [openMemberId]);

  async function handleSetClass(groupId: string, groupClass: GroupClass) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set_class",
            group_id: groupId,
            group_class: groupClass,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Class update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPin(
    enrollmentId: string,
    pinnedGroupNo: number | null,
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/enrollments/${enrollmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned_group_no: pinnedGroupNo }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Pin update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function handleDragEnd(e: DragEndEvent) {
    setError(null);
    const assignmentId = String(e.active.id);
    const overId = e.over?.id;
    if (!overId) return;
    const toGroupNo = Number(String(overId).replace(/^group-/, ""));
    if (!Number.isFinite(toGroupNo)) return;

    // Find current group of this assignment.
    const sourceGroup = props.groups.find((g) =>
      g.members.some((m) => m.assignment_id === assignmentId),
    );
    if (!sourceGroup || sourceGroup.group_no === toGroupNo) return;

    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "move",
            assignment_id: assignmentId,
            to_group_no: toGroupNo,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Move failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRole(
    assignmentId: string,
    role: GroupMemberRole,
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set_role",
            assignment_id: assignmentId,
            role,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Role update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!props.canGenerate) return;
    if (busy) return;
    const confirmMsg = props.groups.length > 0
      ? "Re-generate groups? Existing groups + assignments will be replaced."
      : "Generate groups now? This will run the LLM and may take 20–30 seconds.";
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/generate`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        strategy?: string;
        groups_inserted?: number;
        llm_fallback_reason?: string | null;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Generate failed");
        return;
      }
      const fallbackNote = json.llm_fallback_reason
        ? ` (LLM fell back: ${json.llm_fallback_reason})`
        : "";
      setError(`✓ Generated ${json.groups_inserted ?? 0} groups via ${json.strategy ?? "?"}${fallbackNote}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const totalGroups = props.groups.length;
  const hasShortfalls = props.rosterShortfalls.length > 0;

  return (
    <div>
      <div className="flex items-center justify-end gap-2 flex-wrap mb-4">
        {props.mode === "tables" && totalGroups > 0 ? (
          <a
            href={`/api/admin/events/${props.eventId}/groups/export`}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] tracking-[0.04em] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
            aria-label="Export grouping as XLSX"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 1.5v6M3.5 5L6 7.5 8.5 5" />
              <path d="M2 9.5v0.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-0.5" />
            </svg>
            Export XLSX
          </a>
        ) : null}
        {props.canGenerate ? (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
          >
            {busy ? "Working…" : totalGroups > 0 ? "Re-generate groups" : "Generate groups"}
          </button>
        ) : null}
      </div>

      {hasShortfalls ? (
        <RosterShortfallBanner
          eventId={props.eventId}
          shortfalls={props.rosterShortfalls}
        />
      ) : null}

      {props.canGenerate && props.mode === "tables" ? (
        <PreGenerationPanel
          memberCountByClass={props.memberCountByClass}
          kByClass={props.kByClass}
          shortfalls={props.rosterShortfalls}
        />
      ) : null}

      {error ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-2.5 text-[12px] text-[var(--ink-soft)]">
          {error}
        </div>
      ) : null}

      {props.mode === "cushions" ? (
        <CushionPreview cushions={props.cushions} />
      ) : totalGroups === 0 ? (
        <EmptyState enrolmentCount={props.enrolmentCount} canGenerate={props.canGenerate} />
      ) : (
        <DndContext
          sensors={sensors}
          onDragEnd={props.canEdit ? handleDragEnd : undefined}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {props.groups.map((g) => (
              <GroupCard
                key={g.id}
                eventId={props.eventId}
                group={g}
                groupSizeMax={props.groupSizeMax}
                groupSizeMin={props.groupSizeMin}
                canEdit={props.canEdit}
                onSetRole={handleSetRole}
                onSetClass={handleSetClass}
                onSetPin={handleSetPin}
                openMemberId={openMemberId}
                setOpenMemberId={setOpenMemberId}
                expandedMemberId={expandedMemberId}
                setExpandedMemberId={setExpandedMemberId}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}

function RosterShortfallBanner({
  eventId,
  shortfalls,
}: {
  eventId: string;
  shortfalls: RosterShortfall[];
}) {
  // Group by tier so admin sees one line per missing tier rather than 8
  // duplicates ("3x KR for strategic mains, 1x recruitment for key
  // mains, ..."). Aggregate the worst gap (max need - have) per tier.
  type Agg = { tier: ZuZhangTier; classes: Set<GroupClass>; need: number; have: number };
  const byTier = new Map<ZuZhangTier, Agg>();
  for (const s of shortfalls) {
    const cur = byTier.get(s.required_tier);
    if (!cur) {
      byTier.set(s.required_tier, {
        tier: s.required_tier,
        classes: new Set([s.group_class]),
        need: s.need,
        have: s.have,
      });
    } else {
      cur.classes.add(s.group_class);
      cur.need += s.need - s.have;
    }
  }
  const lines = [...byTier.values()];

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar-deep)]">
            <span aria-hidden="true">⚠</span>
            Roster shortfall · 组长不足
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--ink)]">
            {lines.map((l) => (
              <li key={l.tier}>
                Need <span className="tabular-nums font-medium">{l.need}</span>{" "}
                more {ZU_ZHANG_TIER_LABEL[l.tier].cn} · {ZU_ZHANG_TIER_LABEL[l.tier].en}
                {" "}
                <span className="text-[var(--ink-mute)]">
                  for{" "}
                  {[...l.classes]
                    .map((c) => GROUP_CLASS_LABEL[c].cn)
                    .join(" / ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <a
          href={`/admin/events/${eventId}/enrollments?curate=1`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[11.5px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper)] transition-colors"
        >
          Curate 组长 ↗
        </a>
      </div>
    </div>
  );
}

function PreGenerationPanel({
  memberCountByClass,
  kByClass,
  shortfalls,
}: {
  memberCountByClass: Record<GroupClass, number>;
  kByClass: Record<GroupClass, number>;
  shortfalls: RosterShortfall[];
}) {
  const classes: GroupClass[] = ["strategic", "key", "growth", "maintenance"];
  const anyMembers = classes.some((c) => memberCountByClass[c] > 0);
  if (!anyMembers) return null;

  // Coverage = which (class, tier, role) slots are short. Index for
  // quick lookup so we can tag class chips when their leader supply
  // is incomplete.
  const shortfallByClass = new Map<GroupClass, RosterShortfall[]>();
  for (const s of shortfalls) {
    const list = shortfallByClass.get(s.group_class) ?? [];
    list.push(s);
    shortfallByClass.set(s.group_class, list);
  }

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-3">
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        Pre-generate preview · 编排预览
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {classes
          .filter((c) => memberCountByClass[c] > 0)
          .map((c) => {
            const incomplete = (shortfallByClass.get(c) ?? []).some(
              (s) => s.have < s.need,
            );
            return (
              <span
                key={c}
                className={`inline-flex items-baseline gap-2 px-2.5 py-1 rounded-[var(--radius-pill)] border text-[11.5px] ${
                  incomplete
                    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink)]"
                }`}
                title={
                  incomplete
                    ? `${GROUP_CLASS_LABEL[c].cn} — leaders short. See banner above.`
                    : `${GROUP_CLASS_LABEL[c].cn} — leader pool ok.`
                }
              >
                <span>{GROUP_CLASS_LABEL[c].cn}</span>
                <span className="text-[var(--ink-mute)] tabular-nums">
                  {memberCountByClass[c]} pax → {kByClass[c]} group
                  {kByClass[c] === 1 ? "" : "s"}
                </span>
              </span>
            );
          })}
      </div>
    </div>
  );
}

function EmptyState({ enrolmentCount, canGenerate }: { enrolmentCount: number; canGenerate: boolean }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-6 py-12 text-center">
      <div className="font-display text-[20px] text-[var(--ink-soft)] leading-[1.3]">
        No groups yet.
      </div>
      <p className="mt-2 max-w-[44ch] mx-auto text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
        {enrolmentCount === 0
          ? "Approve or mark-paid at least one enrolment before generating groups."
          : canGenerate
            ? `Click Generate to cluster ${enrolmentCount} enrolled participants into balanced groups via Claude.`
            : "Ask a super admin to generate groups for this event."}
      </p>
    </div>
  );
}

function CushionPreview({ cushions }: { cushions: GroupBuilderCushion[] }) {
  if (cushions.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-6 py-12 text-center">
        <div className="font-display text-[20px] text-[var(--ink-soft)] leading-[1.3]">
          No cushions placed yet.
        </div>
        <p className="mt-2 max-w-[44ch] mx-auto text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
          Open the floor-plan editor and place cushion shapes first; cushion-mode
          generate seats participants into the cushions you draw.
        </p>
      </div>
    );
  }
  // Group cushions into rows by y_pct (already sorted by load).
  type Row = GroupBuilderCushion[];
  const rows: Row[] = [];
  let cur: Row = [];
  let bandY = -Infinity;
  for (const c of cushions) {
    if (cur.length === 0 || Math.abs(c.y_pct - bandY) > 4) {
      if (cur.length > 0) rows.push(cur);
      cur = [c];
      bandY = c.y_pct;
    } else {
      cur.push(c);
    }
  }
  if (cur.length > 0) rows.push(cur);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, ri) => (
        <div
          key={ri}
          className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 shadow-[var(--shadow-paper-1)]"
        >
          <div className="flex items-baseline gap-3 mb-3">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              Row {ri + 1}
            </div>
            <span className="text-[11px] text-[var(--ink-mute)] tabular-nums">
              {row.length} cushions
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.map((c) => (
              <CushionChip key={c.shape_id} cushion={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CushionChip({ cushion: c }: { cushion: GroupBuilderCushion }) {
  if (!c.participant_id) {
    return (
      <span className="inline-flex items-center h-7 px-2 rounded-[var(--radius-pill)] border border-dashed border-[var(--paper-shadow)] text-[10.5px] text-[var(--ink-faint)]">
        empty
      </span>
    );
  }
  const name = c.name_en || c.name_cn || "—";
  const isPai = c.role === "pai_zhang";
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-pill)] border text-[11px] ${
        isPai
          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]"
      }`}
      title={isPai ? "排长" : undefined}
    >
      {c.region_id ? (
        <span className="font-mono text-[9.5px] text-[var(--cinnabar-deep)]">
          {c.region_id}
        </span>
      ) : null}
      <span>{name}</span>
      {isPai ? <span className="text-[9.5px] tracking-[0.18em] uppercase">排</span> : null}
    </span>
  );
}

function GroupCard({
  eventId,
  group,
  groupSizeMax,
  groupSizeMin,
  canEdit,
  onSetRole,
  onSetClass,
  onSetPin,
  openMemberId,
  setOpenMemberId,
  expandedMemberId,
  setExpandedMemberId,
}: {
  eventId: string;
  group: GroupBuilderGroup;
  groupSizeMax: number;
  groupSizeMin: number;
  canEdit: boolean;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
  onSetClass: (groupId: string, groupClass: GroupClass) => Promise<void>;
  onSetPin: (
    enrollmentId: string,
    pinnedGroupNo: number | null,
  ) => Promise<void>;
  openMemberId: string | null;
  setOpenMemberId: (id: string | null) => void;
  expandedMemberId: string | null;
  setExpandedMemberId: (id: string | null) => void;
}) {
  const router = useRouter();
  const { isOver, setNodeRef } = useDroppable({ id: `group-${group.group_no}` });
  const sizeChip =
    group.members.length > groupSizeMax || group.members.length < groupSizeMin
      ? "out"
      : "ok";
  const [editingRationale, setEditingRationale] = useState(false);
  const [rationaleEn, setRationaleEn] = useState(group.rationale_en ?? "");
  const [rationaleCn, setRationaleCn] = useState(group.rationale_cn ?? "");
  const [savingRationale, setSavingRationale] = useState(false);

  async function saveRationale() {
    setSavingRationale(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/groups/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_rationale",
          group_id: group.id,
          rationale_en: rationaleEn,
          rationale_cn: rationaleCn,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.detail ?? json.error ?? "Save failed");
        return;
      }
      setEditingRationale(false);
      router.refresh();
    } finally {
      setSavingRationale(false);
    }
  }

  const hasZuZhang = group.members.some((m) => m.role === "zu_zhang");
  const hasFuZuZhang = group.members.some((m) => m.role === "fu_zu_zhang");
  const needsLeader = !hasZuZhang || !hasFuZuZhang;

  return (
    <section
      ref={setNodeRef}
      className={`relative rounded-[var(--radius-lg)] border p-4 transition-colors ${
        isOver
          ? "border-[var(--cinnabar)]/50 bg-[var(--cinnabar-wash)]/30 shadow-[var(--shadow-focus)]"
          : needsLeader
            ? "border-[var(--cinnabar)]/35 bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]"
            : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="inline-flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] tabular-nums text-[var(--cinnabar-deep)]">
            #{group.group_no}
          </span>
          {canEdit ? (
            <ClassDropdown
              groupClass={group.group_class}
              onChange={(c) => onSetClass(group.id, c)}
            />
          ) : (
            <ClassChip groupClass={group.group_class} />
          )}
          <span
            className={`inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border text-[10px] tabular-nums ${
              sizeChip === "out"
                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]"
            }`}
          >
            {group.members.length} pax
          </span>
          {!hasZuZhang ? (
            <span
              className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] text-[9.5px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
              title="No 组长 seated. Promote a member or curate one via /enrollments."
            >
              missing 主组长
            </span>
          ) : null}
          {!hasFuZuZhang ? (
            <span
              className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/45 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.04em] text-[var(--gold-deep)]"
              title="No 副组长 seated."
            >
              missing 副组长
            </span>
          ) : null}
        </div>
        {canEdit && !editingRationale ? (
          <button
            type="button"
            onClick={() => setEditingRationale(true)}
            className="text-[10.5px] tracking-[0.04em] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] transition-colors"
          >
            edit rationale
          </button>
        ) : null}
      </div>

      <DimensionCoverageStrip group={group} />

      {editingRationale ? (
        <div className="mb-3 flex flex-col gap-2">
          <textarea
            value={rationaleEn}
            onChange={(e) => setRationaleEn(e.target.value)}
            placeholder="Rationale (English)"
            rows={2}
            className="w-full px-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)]"
          />
          <textarea
            value={rationaleCn}
            onChange={(e) => setRationaleCn(e.target.value)}
            placeholder="说明（中文）"
            rows={2}
            className="w-full px-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)]"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setRationaleEn(group.rationale_en ?? "");
                setRationaleCn(group.rationale_cn ?? "");
                setEditingRationale(false);
              }}
              className="text-[11px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveRationale}
              disabled={savingRationale}
              className="text-[11px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {group.rationale_en ? (
            <p className="mb-1.5 text-[11.5px] leading-[1.5] text-[var(--ink-soft)]">
              {group.rationale_en}
            </p>
          ) : null}
          {group.rationale_cn ? (
            <p className="mb-3 text-[11.5px] leading-[1.5] text-[var(--ink-mute)]">
              {group.rationale_cn}
            </p>
          ) : null}
        </>
      )}

      {group.members.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-faint)] italic">
          empty group
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--paper-shadow)]/60">
          <table className="w-full text-[11.5px]">
            <thead className="bg-[var(--paper-deep)]/40 border-b border-[var(--paper-shadow)]/60 text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium w-[26px]" aria-label="Role" />
                <th className="text-left px-2 py-1.5 font-medium w-[60px]">ID</th>
                <th className="text-left px-2 py-1.5 font-medium">Name</th>
                <th className="text-left px-2 py-1.5 font-medium w-[44px]">Tier</th>
                <th className="text-left px-1 py-1.5 font-medium w-[24px]" aria-label="Goal" />
                <th className="text-left px-2 py-1.5 font-medium w-[68px]">Flags</th>
                <th className="text-right px-2 py-1.5 font-medium w-[26px]" aria-label="Detail" />
              </tr>
            </thead>
            <tbody>
              {sortMembers(group.members).map((m) => (
                <MemberRow
                  key={m.assignment_id}
                  member={m}
                  groupClass={group.group_class}
                  groupNo={group.group_no}
                  canEdit={canEdit}
                  onSetRole={onSetRole}
                  onSetPin={onSetPin}
                  isOpen={openMemberId === m.assignment_id}
                  setOpen={(v) =>
                    setOpenMemberId(v ? m.assignment_id : null)
                  }
                  isExpanded={expandedMemberId === m.assignment_id}
                  setExpanded={(v) =>
                    setExpandedMemberId(v ? m.assignment_id : null)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sortMembers(members: GroupBuilderMember[]): GroupBuilderMember[] {
  // Leaders pinned at top (组长 first, then 副组长), participants
  // alphabetical by region_id so the same person always sorts to the
  // same row across regenerates.
  const order: Record<GroupMemberRole, number> = {
    zu_zhang: 0,
    fu_zu_zhang: 1,
    pai_zhang: 2,
    participant: 3,
  };
  return [...members].sort((a, b) => {
    const ra = order[a.role];
    const rb = order[b.role];
    if (ra !== rb) return ra - rb;
    return (a.region_id ?? "").localeCompare(b.region_id ?? "");
  });
}

function memberLabel(m: GroupBuilderMember): string {
  const en = m.name_en?.trim();
  const cn = m.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

function MemberRow({
  member,
  groupClass,
  groupNo,
  canEdit,
  onSetRole,
  onSetPin,
  isOpen,
  setOpen,
  isExpanded,
  setExpanded,
}: {
  member: GroupBuilderMember;
  groupClass: GroupClass;
  groupNo: number;
  canEdit: boolean;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
  onSetPin: (
    enrollmentId: string,
    pinnedGroupNo: number | null,
  ) => Promise<void>;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  isExpanded: boolean;
  setExpanded: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: member.assignment_id,
    disabled: !canEdit,
  });
  const name = memberLabel(member);
  const isLeader = member.role === "zu_zhang" || member.role === "fu_zu_zhang";
  const roleTone =
    member.role === "zu_zhang"
      ? "bg-[var(--cinnabar-wash)]/60"
      : member.role === "fu_zu_zhang"
        ? "bg-[var(--gold-soft)]/45"
        : "";
  const primaryGoal: GrowthDimension | null = member.goal_dimensions[0] ?? null;
  const secondaryGoal: GrowthDimension | null = member.goal_dimensions[1] ?? null;
  const classMismatch = !isLeader && member.effective_class !== groupClass;
  const pinnedHere =
    member.pinned_group_no != null && member.pinned_group_no === groupNo;

  const style: React.CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
        position: "relative",
      }
    : undefined;

  return (
    <>
      <tr
        ref={setNodeRef}
        style={style}
        data-member-row={member.assignment_id}
        {...listeners}
        {...attributes}
        className={`relative border-b border-[var(--paper-shadow)]/40 last:border-b-0 ${roleTone} ${canEdit ? "cursor-grab active:cursor-grabbing hover:bg-[var(--paper-deep)]/35" : ""}`}
        title={canEdit ? "Drag to another group · click to set role / pin" : undefined}
        onClick={(e) => {
          if (!canEdit) return;
          e.stopPropagation();
          setOpen(!isOpen);
        }}
      >
        <td className="px-2 py-1.5 align-middle">
          {member.role === "zu_zhang" ? (
            <span
              className="inline-flex items-center justify-center h-[16px] px-1.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[9px] tracking-[0.06em]"
              title="组长"
            >
              组
            </span>
          ) : member.role === "fu_zu_zhang" ? (
            <span
              className="inline-flex items-center justify-center h-[16px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/60 bg-[var(--gold-soft)] text-[var(--ink)] text-[9px] tracking-[0.06em]"
              title="副组长"
            >
              副
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1.5 align-middle font-mono text-[10px] text-[var(--cinnabar-deep)] tabular-nums">
          {member.region_id ?? ""}
        </td>
        <td className="px-2 py-1.5 align-middle text-[var(--ink)]">
          {name}
        </td>
        <td className="px-2 py-1.5 align-middle">
          {isLeader && member.zu_zhang_tier ? (
            <TierBadge tier={member.zu_zhang_tier} grade={member.zu_zhang_grade} />
          ) : null}
        </td>
        <td className="px-1 py-1.5 align-middle text-center">
          {primaryGoal ? (
            <span
              className="text-[12px]"
              title={`Primary goal: ${GROWTH_DIMENSION_LABEL[primaryGoal].cn}`}
            >
              {GROWTH_DIMENSION_LABEL[primaryGoal].icon}
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1.5 align-middle">
          <span className="inline-flex items-center gap-1">
            {member.is_old_student ? (
              <span
                title="老学员"
                className="inline-flex items-center justify-center h-[14px] w-[14px] rounded-full border border-[var(--ink-faint)]/50 text-[8.5px] tracking-normal text-[var(--ink-mute)]"
              >
                旧
              </span>
            ) : null}
            {classMismatch && member.qualification ? (
              <span
                className="inline-flex items-center h-[14px] px-1 rounded-[var(--radius-pill)] border border-[var(--gold)]/50 bg-[var(--gold-soft)]/60 text-[9px] tracking-[0.04em] text-[var(--gold-deep)]"
                title={`Qualification (${STUDENT_QUALIFICATION_LABEL[member.qualification].cn}) doesn't match group class (${GROUP_CLASS_LABEL[groupClass].cn}). Override or pin?`}
              >
                {STUDENT_QUALIFICATION_LABEL[member.qualification].short_cn}
              </span>
            ) : null}
            {member.pinned_group_no ? (
              <span
                className="inline-flex items-center h-[14px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 text-[9px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
                title={
                  pinnedHere
                    ? `Pinned to this group (#${member.pinned_group_no})`
                    : `Pinned to group #${member.pinned_group_no} — currently in #${groupNo}`
                }
              >
                📌{member.pinned_group_no}
              </span>
            ) : null}
          </span>
          {isOpen && canEdit ? (
            <span
              data-role-popover
              className="absolute z-10 right-2 mt-1 flex flex-col rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] text-[11px]"
            >
              {(["zu_zhang", "fu_zu_zhang", "participant"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setOpen(false);
                    await onSetRole(member.assignment_id, r);
                  }}
                  className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] whitespace-nowrap"
                >
                  {r === "zu_zhang" ? "组长" : r === "fu_zu_zhang" ? "副组长" : "participant"}
                </button>
              ))}
              {member.enrollment_id ? (
                <>
                  <span className="border-t border-[var(--paper-shadow)]/60" />
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setOpen(false);
                      await onSetPin(
                        member.enrollment_id!,
                        pinnedHere ? null : groupNo,
                      );
                    }}
                    className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] text-[var(--cinnabar-deep)] whitespace-nowrap"
                  >
                    {pinnedHere ? "Unpin · 取消固定" : `Pin here · 固定 #${groupNo}`}
                  </button>
                  {member.pinned_group_no != null && !pinnedHere ? (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setOpen(false);
                        await onSetPin(member.enrollment_id!, null);
                      }}
                      className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] text-[var(--ink-mute)] whitespace-nowrap"
                    >
                      Clear pin · 取消固定 #{member.pinned_group_no}
                    </button>
                  ) : null}
                </>
              ) : null}
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1.5 align-middle text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!isExpanded);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--ink-faint)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink-mute)]"
            aria-label={isExpanded ? "Collapse detail" : "Expand detail"}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
              aria-hidden="true"
            >
              <path d="M3.5 2L7 5l-3.5 3" />
            </svg>
          </button>
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-b border-[var(--paper-shadow)]/40 bg-[var(--paper)]/60">
          <td colSpan={7} className="px-3 py-2.5">
            <MemberDetail member={member} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MemberDetail({ member }: { member: GroupBuilderMember }) {
  const fin = member.financial_score ?? 0;
  const inf = member.influence_score ?? 0;
  const overrode =
    member.qualification_override
    && member.qualification_override !== member.qualification_computed;
  return (
    <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-[var(--ink-soft)]">
      <DetailRow label="Financial · 财力">
        <ScoreInline value={fin} />
      </DetailRow>
      <DetailRow label="Influence · 影响力">
        <ScoreInline value={inf} />
      </DetailRow>
      <DetailRow label="Qualification · 等级">
        {member.qualification ? (
          <span className="text-[var(--ink)]">
            {STUDENT_QUALIFICATION_LABEL[member.qualification].cn} ·{" "}
            {STUDENT_QUALIFICATION_LABEL[member.qualification].en}
            {overrode && member.qualification_computed ? (
              <span className="ml-2 text-[10px] text-[var(--ink-mute)]">
                (override; computed:{" "}
                {STUDENT_QUALIFICATION_LABEL[member.qualification_computed].cn})
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[var(--ink-faint)]">—</span>
        )}
      </DetailRow>
      <DetailRow label="Motivation · 动机">
        {member.motivation_tag ? (
          <span className="text-[var(--ink)]">{member.motivation_tag}</span>
        ) : (
          <span className="text-[var(--ink-faint)]">—</span>
        )}
      </DetailRow>
      <DetailRow label="Old student · 老学员">
        {member.is_old_student ? (
          <span className="text-[var(--cinnabar-deep)]">Yes · 是</span>
        ) : (
          <span className="text-[var(--ink-mute)]">No</span>
        )}
      </DetailRow>
      <DetailRow label="带组次数">
        <span className="tabular-nums text-[var(--ink)]">
          {member.times_led_groups}
        </span>
        {member.has_special_contribution ? (
          <span className="ml-2 text-[10px] tracking-[0.18em] uppercase text-[var(--gold-deep)] bg-[var(--gold-soft)] px-1.5 py-0.5 rounded-full border border-[var(--gold)]/40">
            特殊贡献
          </span>
        ) : null}
      </DetailRow>
      <DetailRow label="Goals · 成长方向">
        {member.goal_dimensions.length === 0 ? (
          <span className="text-[var(--ink-faint)]">—</span>
        ) : (
          <span className="inline-flex items-center gap-2 flex-wrap text-[var(--ink)]">
            {member.goal_dimensions.map((d, i) => (
              <span key={d} className="inline-flex items-center gap-1">
                {i === 0 ? <span className="text-[10px] text-[var(--cinnabar-deep)]">★</span> : null}
                <span>{GROWTH_DIMENSION_LABEL[d].icon}</span>
                <span>{GROWTH_DIMENSION_LABEL[d].cn}</span>
              </span>
            ))}
          </span>
        )}
      </DetailRow>
      <DetailRow label="Family · 家人">
        {member.family_partner_region_ids.length === 0 ? (
          <span className="text-[var(--ink-faint)]">—</span>
        ) : (
          <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
            {member.family_partner_region_ids.join(" / ")}
          </span>
        )}
      </DetailRow>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <span className="shrink-0 w-[120px] text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function ScoreInline({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums text-[var(--ink)]">{value || "—"}</span>
      <span className="inline-block w-16 h-1 rounded-full bg-[var(--paper-deep)]">
        <span
          className="block h-1 rounded-full bg-[var(--cinnabar)]"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </span>
    </span>
  );
}

function ClassDropdown({
  groupClass,
  onChange,
}: {
  groupClass: GroupClass;
  onChange: (c: GroupClass) => void;
}) {
  const lab = GROUP_CLASS_LABEL[groupClass];
  const tone =
    groupClass === "strategic"
      ? "border-[var(--cinnabar)]/60 bg-[var(--cinnabar)] text-[var(--paper)]"
      : groupClass === "key"
        ? "border-[var(--gold)]/60 bg-[var(--gold-soft)] text-[var(--gold-deep)]"
        : groupClass === "growth"
          ? "border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[var(--ink)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]";
  return (
    <label
      className={`inline-flex items-center h-[18px] pl-2 pr-1 rounded-[var(--radius-pill)] border text-[10px] tracking-[0.06em] cursor-pointer ${tone}`}
      title="Click to change class"
    >
      <span>{lab.cn}</span>
      <select
        value={groupClass}
        onChange={(e) => onChange(e.target.value as GroupClass)}
        onClick={(e) => e.stopPropagation()}
        className="ml-1 bg-transparent text-[10px] cursor-pointer outline-none border-0 focus:outline-none"
      >
        {(["strategic", "key", "growth", "maintenance"] as GroupClass[]).map((c) => (
          <option key={c} value={c} className="text-[var(--ink)] bg-[var(--paper)]">
            {GROUP_CLASS_LABEL[c].cn} · {GROUP_CLASS_LABEL[c].en}
          </option>
        ))}
      </select>
    </label>
  );
}

function ClassChip({ groupClass }: { groupClass: GroupClass }) {
  const lab = GROUP_CLASS_LABEL[groupClass];
  const tone =
    groupClass === "strategic"
      ? "border-[var(--cinnabar)]/60 bg-[var(--cinnabar)] text-[var(--paper)]"
      : groupClass === "key"
        ? "border-[var(--gold)]/60 bg-[var(--gold-soft)] text-[var(--gold-deep)]"
        : groupClass === "growth"
          ? "border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[var(--ink)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]";
  const required = requiredLeaderTiers(groupClass);
  return (
    <span
      title={`${lab.cn} — main: ${ZU_ZHANG_TIER_LABEL[required.main].cn}, auxiliary: ${ZU_ZHANG_TIER_LABEL[required.auxiliary].cn}`}
      className={`inline-flex items-center h-[18px] px-2 rounded-[var(--radius-pill)] border text-[10px] tracking-[0.06em] ${tone}`}
    >
      {lab.cn}
    </span>
  );
}

function TierBadge({
  tier,
  grade,
}: {
  tier: ZuZhangTier;
  grade: number | null;
}) {
  const lab = ZU_ZHANG_TIER_LABEL[tier];
  if (grade == null) {
    return (
      <span
        title={`${lab.cn} · ${lab.en}`}
        className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-[var(--ink)] text-[var(--paper)] text-[9px] tracking-normal"
      >
        {lab.short_cn}
      </span>
    );
  }
  return (
    <span
      title={`${lab.cn} · grade ${grade}/5`}
      className="inline-flex items-center justify-center gap-[1px] h-[16px] px-[5px] rounded-[8px] bg-[var(--ink)] text-[var(--paper)] text-[9px] tabular-nums tracking-normal"
    >
      <span>{lab.short_cn}</span>
      <span className="opacity-90">{grade}</span>
    </span>
  );
}

function DimensionCoverageStrip({ group }: { group: GroupBuilderGroup }) {
  // Aggregate which growth dimensions are covered by ≥1 member's primary
  // goal; flag a mismatch warning when >40% of non-leader members declare
  // a primary goal NOT covered by any 组长 in the group.
  const leaders = group.members.filter(
    (m) => m.role === "zu_zhang" || m.role === "fu_zu_zhang",
  );
  const coverage = new Set<GrowthDimension>();
  for (const l of leaders) for (const d of l.zu_zhang_dimensions) coverage.add(d);
  const regulars = group.members.filter(
    (m) => m.role === "participant" || m.role === "pai_zhang",
  );
  let mismatches = 0;
  for (const m of regulars) {
    const g = m.goal_dimensions[0];
    if (g && !coverage.has(g)) mismatches += 1;
  }
  const ratio = regulars.length > 0 ? mismatches / regulars.length : 0;
  const showWarn = ratio > 0.4;

  return (
    <div className="flex items-center gap-1.5 mb-2 text-[10px] text-[var(--ink-mute)]">
      <span className="tracking-[0.16em] uppercase">Coverage</span>
      <div className="flex items-center gap-1">
        {(["financial", "relationship", "health", "inner_peace"] as GrowthDimension[]).map(
          (d) => {
            const has = coverage.has(d);
            return (
              <span
                key={d}
                title={`${GROWTH_DIMENSION_LABEL[d].cn} ${has ? "covered" : "not covered"}`}
                className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] ${
                  has
                    ? "bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/40"
                    : "bg-[var(--paper-deep)]/50 border border-[var(--paper-shadow)] opacity-50"
                }`}
              >
                {GROWTH_DIMENSION_LABEL[d].icon}
              </span>
            );
          },
        )}
      </div>
      {showWarn ? (
        <span
          className="inline-flex items-center h-[16px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/60 bg-[var(--gold-soft)] text-[10px] text-[var(--gold-deep)]"
          title={`${mismatches}/${regulars.length} members have a primary goal not covered by this group's 组长`}
        >
          mismatch
        </span>
      ) : null}
    </div>
  );
}
