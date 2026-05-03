"use client";

import { useState } from "react";
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
import type { GroupMemberRole, SeatingMode } from "@/lib/grouping/types";

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
};

export function GroupsClient(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex items-center justify-end gap-2 flex-wrap mb-4">
        {props.canGenerate ? (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
          >
            {busy ? "Working…" : props.groups.length > 0 ? "Re-generate groups" : "Generate groups"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-2.5 text-[12px] text-[var(--ink-soft)]">
          {error}
        </div>
      ) : null}

      {props.mode === "cushions" ? (
        <CushionPreview cushions={props.cushions} />
      ) : props.groups.length === 0 ? (
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
              />
            ))}
          </div>
        </DndContext>
      )}
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
}: {
  eventId: string;
  group: GroupBuilderGroup;
  groupSizeMax: number;
  groupSizeMin: number;
  canEdit: boolean;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
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

  return (
    <section
      ref={setNodeRef}
      className={`relative rounded-[var(--radius-lg)] border p-4 transition-colors ${
        isOver
          ? "border-[var(--cinnabar)]/50 bg-[var(--cinnabar-wash)]/30 shadow-[var(--shadow-focus)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="inline-flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-[var(--cinnabar-deep)]">
            #{group.group_no}
          </span>
          <span
            className={`inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border text-[10px] tabular-nums ${
              sizeChip === "out"
                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]"
            }`}
          >
            {group.members.length} pax
          </span>
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

      <div className="flex flex-wrap gap-1.5">
        {group.members.map((m) => (
          <MemberChip
            key={m.assignment_id}
            member={m}
            canEdit={canEdit}
            onSetRole={onSetRole}
          />
        ))}
        {group.members.length === 0 ? (
          <span className="text-[11px] text-[var(--ink-faint)] italic">
            empty group
          </span>
        ) : null}
      </div>
    </section>
  );
}

function MemberChip({
  member,
  canEdit,
  onSetRole,
}: {
  member: GroupBuilderMember;
  canEdit: boolean;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: member.assignment_id,
    disabled: !canEdit,
  });
  const [open, setOpen] = useState(false);
  const name = member.name_en || member.name_cn || "—";
  const roleLabel =
    member.role === "zu_zhang"
      ? "组长"
      : member.role === "fu_zu_zhang"
        ? "副组长"
        : null;
  const roleTone =
    member.role === "zu_zhang"
      ? "border-[var(--cinnabar)]/50 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
      : member.role === "fu_zu_zhang"
        ? "border-[var(--gold)]/50 bg-[var(--gold-soft)] text-[var(--ink)]"
        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]";

  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <span
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-pill)] border text-[11px] ${roleTone} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
      title={canEdit ? "Drag to a different group · click to set role" : undefined}
      onClick={(e) => {
        if (!canEdit) return;
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {member.region_id ? (
        <span className="font-mono text-[9.5px] text-[var(--cinnabar-deep)]">
          {member.region_id}
        </span>
      ) : null}
      <span>{name}</span>
      {member.is_old_student ? (
        <span className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">旧</span>
      ) : null}
      {roleLabel ? (
        <span className="text-[9.5px] tracking-[0.18em] uppercase">
          {roleLabel}
        </span>
      ) : null}
      {member.pinned_group_no ? (
        <span
          className="inline-flex items-center h-[14px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 text-[9px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
          title={`Pinned to group #${member.pinned_group_no}`}
        >
          📌{member.pinned_group_no}
        </span>
      ) : null}
      {open && canEdit ? (
        <span
          className="absolute z-10 mt-1 ml-1 flex flex-col rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] text-[11px]"
          style={{ transform: "translateY(28px)" }}
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
              className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)]"
            >
              {r === "zu_zhang" ? "组长" : r === "fu_zu_zhang" ? "副组长" : "participant"}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
