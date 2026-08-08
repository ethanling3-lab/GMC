"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  GroupBuilderCushion,
  GroupBuilderGroup,
  GroupBuilderLeaderCandidate,
  GroupBuilderMember,
  GroupBuilderUnassigned,
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
  StudentQualification,
  ZuZhangTier,
} from "@/lib/grouping/types";
import { GroupsImportDialog } from "./GroupsImportDialog";
import { GroupsBulkBar } from "./GroupsBulkBar";
import { LeaderPickerDialog } from "./LeaderPickerDialog";
import type { LeaderRole } from "./LeaderPickerDialog";

// Mode-aware client surface for the GroupBuilder. Table mode renders a
// stack of group cards; all reassignment is click-based (member menu →
// Move to #N / Unassign, and the Unassigned pool's + → #N) — no drag-drop.
// Cushion mode renders a flat ranked preview list.

// Where one participant sat before a mutation. group_id null = they were
// unassigned, so restoring means taking them back out.
type UndoEntry = {
  participant_id: string;
  group_id: string | null;
  role: GroupMemberRole;
};

type UndoRecord = { label: string; entries: UndoEntry[] };

// Optimistic layer.
//
// An UndoEntry describes "this participant sits in this group with this
// role" — which is equally the shape of a PREDICTED post-action state. So
// every mutation computes two overlays of the same type: the `before` one
// becomes the undo record, the `after` one is applied to the rendered
// state immediately and discarded when fresh server data lands.
//
// Reusing one shape for both is the point: a bespoke optimistic reducer
// per action is where the client quietly drifts from the server.
//
// Everything a group card derives — pax count, leader chips, family and
// duplicate flags — is computed from `group.members`, so it all follows
// the overlay without extra work.
function memberFromUnassigned(
  u: GroupBuilderUnassigned,
  role: GroupMemberRole,
): GroupBuilderMember {
  // Seating someone straight from the pool: the chip payload is
  // deliberately lightweight, so the detail-only fields render empty for
  // the sub-second before reconciliation replaces this with the real row.
  return {
    assignment_id: `optimistic:${u.participant_id}`,
    enrollment_id: u.enrollment_id,
    participant_id: u.participant_id,
    region_id: u.region_id,
    name_en: u.name_en,
    name_cn: u.name_cn,
    is_old_student: u.is_old_student,
    influence_score: null,
    financial_score: null,
    pinned_group_no: null,
    role,
    zu_zhang_tier: u.zu_zhang_tier,
    zu_zhang_grade: null,
    zu_zhang_dimensions: [],
    goal_dimensions: [],
    qualification: u.qualification,
    qualification_override: null,
    qualification_computed: null,
    effective_class: u.effective_class,
    motivation_tag: null,
    has_special_contribution: false,
    times_led_groups: 0,
    family_partner_region_ids: [],
    energy_profile: null,
    language_fluency: null,
    conflict_partner_region_ids: [],
    duplicate_partners: [],
  };
}

function unassignedFromMember(m: GroupBuilderMember): GroupBuilderUnassigned {
  return {
    participant_id: m.participant_id,
    enrollment_id: m.enrollment_id,
    region_id: m.region_id,
    name_en: m.name_en,
    name_cn: m.name_cn,
    is_old_student: m.is_old_student,
    qualification: m.qualification,
    effective_class: m.effective_class,
    zu_zhang_tier: m.zu_zhang_tier,
  };
}

function applyOverlay(
  groups: GroupBuilderGroup[],
  unassigned: GroupBuilderUnassigned[],
  overlay: UndoEntry[] | null,
): { groups: GroupBuilderGroup[]; unassigned: GroupBuilderUnassigned[] } {
  if (!overlay || overlay.length === 0) return { groups, unassigned };
  const target = new Map(overlay.map((e) => [e.participant_id, e]));
  const memberByPid = new Map<string, GroupBuilderMember>();
  for (const g of groups) {
    for (const m of g.members) memberByPid.set(m.participant_id, m);
  }
  const pooledByPid = new Map(unassigned.map((u) => [u.participant_id, u]));

  const nextGroups = groups.map((g) => {
    const kept = g.members
      .filter((m) => {
        const t = target.get(m.participant_id);
        return t ? t.group_id === g.id : true;
      })
      .map((m) => {
        const t = target.get(m.participant_id);
        return t && t.role !== m.role ? { ...m, role: t.role } : m;
      });
    const keptPids = new Set(kept.map((m) => m.participant_id));
    const arrivals: GroupBuilderMember[] = [];
    for (const e of overlay) {
      if (e.group_id !== g.id || keptPids.has(e.participant_id)) continue;
      const existing = memberByPid.get(e.participant_id);
      if (existing) {
        arrivals.push({ ...existing, role: e.role });
        continue;
      }
      const pooled = pooledByPid.get(e.participant_id);
      if (pooled) arrivals.push(memberFromUnassigned(pooled, e.role));
    }
    return { ...g, members: [...kept, ...arrivals] };
  });

  const nextUnassigned = unassigned.filter((u) => {
    const t = target.get(u.participant_id);
    return !(t && t.group_id);
  });
  const pooledPids = new Set(nextUnassigned.map((u) => u.participant_id));
  for (const e of overlay) {
    if (e.group_id !== null || pooledPids.has(e.participant_id)) continue;
    const m = memberByPid.get(e.participant_id);
    if (m) nextUnassigned.push(unassignedFromMember(m));
  }

  return { groups: nextGroups, unassigned: nextUnassigned };
}

type Props = {
  eventId: string;
  mode: SeatingMode;
  groupSizeMin: number;
  groupSizeMax: number;
  enrolmentCount: number;
  groups: GroupBuilderGroup[];
  unassigned: GroupBuilderUnassigned[];
  zuZhangRoster: GroupBuilderLeaderCandidate[];
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
  const [importOpen, setImportOpen] = useState(false);
  // Which group's leader picker is open, and which slot it opened on.
  const [leaderPick, setLeaderPick] = useState<
    { groupId: string; role: LeaderRole } | null
  >(null);
  // Phase 4 — multi-selection, keyed on assignment_id and spanning cards.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Phase 5 — one-level undo. Holds where the affected people sat BEFORE
  // the last mutation; the server restores it wholesale. Deliberately not
  // a deep stack: anything older than the toast has probably been
  // invalidated by a Regenerate or another admin, and an undo that
  // silently half-applies is worse than none.
  const [undoRecord, setUndoRecord] = useState<UndoRecord | null>(null);
  // Predicted post-action state, shown until the server's version lands.
  const [overlay, setOverlay] = useState<UndoEntry[] | null>(null);
  // Single open role-popover across the whole page. Click another row
  // → previous popover closes. Click anywhere outside a row → all close.
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  // Single open detail row across the page (mirrors role popover).
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  // Auto-dismiss the toast after a while so it doesn't linger; errors get
  // longer than success confirmations.
  useEffect(() => {
    if (!error) return;
    // An undoable toast has to outlive a glance at the page to be worth
    // anything — 4s is enough to read a confirmation, not to decide.
    const ms = undoRecord ? 14000 : error.startsWith("✓") ? 4000 : 8000;
    const t = setTimeout(() => {
      setError(null);
      setUndoRecord(null);
    }, ms);
    return () => clearTimeout(t);
  }, [error, undoRecord]);

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

  // What the admin actually sees: server truth with any in-flight
  // prediction laid over it. Everything below derives from this rather
  // than from props, so a snapshot taken for undo matches what was on
  // screen when the admin acted.
  const view = useMemo(
    () => applyOverlay(props.groups, props.unassigned, overlay),
    [props.groups, props.unassigned, overlay],
  );
  const viewGroups = view.groups;

  // Reconciliation point. props.groups gets a fresh identity on every
  // server render, so a completed router.refresh() drops the prediction
  // and server truth takes over — including when the server disagreed.
  useEffect(() => {
    setOverlay(null);
  }, [props.groups, props.unassigned]);

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
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetName(
    groupId: string,
    nameEn: string,
    nameCn: string,
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
            action: "set_name",
            group_id: groupId,
            name_en: nameEn,
            name_cn: nameCn,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Name update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetLocked(groupId: string, locked: boolean) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set_locked",
            group_id: groupId,
            locked,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Lock update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetToAuto(groupId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set_edited",
            group_id: groupId,
            edited: false,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Reset failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddGroup(groupClass: GroupClass) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ group_class: groupClass }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Add group failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteGroup(groupId: string, groupNo: number) {
    if (!window.confirm(`Delete group #${groupNo}? It must be empty first.`)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/${groupId}`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Delete failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetQualification(
    participantId: string,
    qualification: StudentQualification | null,
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/participants/${participantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ student_qualification: qualification }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Qualification update failed");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
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
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function patchMembers(
    payload: Record<string, unknown>,
    failMsg: string,
    undo?: UndoRecord,
  ) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? failMsg);
        setOverlay(null);
        return;
      }
      if (undo) {
        setUndoRecord(undo);
        setError(`✓ ${undo.label}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(participantId: string, toGroupNo: number) {
    setError(null);
    const entries = captureSnapshot(
      [participantId],
      [groupIdOfNo(toGroupNo)],
    );
    const seatTarget = groupIdOfNo(toGroupNo);
    setOverlay([
      { participant_id: participantId, group_id: seatTarget, role: "participant" },
    ]);
    await patchMembers(
      { action: "add_member", participant_id: participantId, to_group_no: toGroupNo },
      "Add failed",
      { label: `Seated into #${toGroupNo}`, entries },
    );
  }

  async function handleRemoveMember(assignmentId: string) {
    setError(null);
    const hit = memberIndex.get(assignmentId);
    const entries = captureSnapshot(
      hit ? [hit.member.participant_id] : [],
      [hit?.groupId ?? null],
    );
    if (hit) {
      setOverlay([
        {
          participant_id: hit.member.participant_id,
          group_id: null,
          role: "participant",
        },
      ]);
    }
    await patchMembers(
      { action: "remove_member", assignment_id: assignmentId },
      "Remove failed",
      {
        label: `Unassigned ${hit ? memberLabel(hit.member) : "member"}`,
        entries,
      },
    );
  }

  async function handleAddMemberMove(assignmentId: string, toGroupNo: number) {
    setError(null);
    const hit = memberIndex.get(assignmentId);
    const entries = captureSnapshot(
      hit ? [hit.member.participant_id] : [],
      [hit?.groupId ?? null, groupIdOfNo(toGroupNo)],
    );
    if (hit) {
      setOverlay([
        {
          participant_id: hit.member.participant_id,
          group_id: groupIdOfNo(toGroupNo),
          role: "participant",
        },
      ]);
    }
    await patchMembers(
      { action: "move", assignment_id: assignmentId, to_group_no: toGroupNo },
      "Move failed",
      {
        label: `Moved ${hit ? memberLabel(hit.member) : "member"} → #${toGroupNo}`,
        entries,
      },
    );
  }

  async function handleSetRole(
    assignmentId: string,
    role: GroupMemberRole,
  ) {
    setError(null);
    const roleHit = memberIndex.get(assignmentId);
    // Snapshot the whole group — promoting to 组长 demotes the incumbent.
    const roleEntries = captureSnapshot(
      roleHit ? [roleHit.member.participant_id] : [],
      [roleHit?.groupId ?? null],
    );
    if (roleHit) {
      setOverlay([
        ...demotedIncumbent(roleHit.groupId, role, roleHit.member.participant_id),
        {
          participant_id: roleHit.member.participant_id,
          group_id: roleHit.groupId,
          role,
        },
      ]);
    }
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
        setOverlay(null);
        return;
      }
      const roleCn =
        role === "zu_zhang"
          ? "组长"
          : role === "fu_zu_zhang"
            ? "副组长"
            : "member";
      setUndoRecord({
        label: `${roleHit ? memberLabel(roleHit.member) : "Member"} → ${roleCn}`,
        entries: roleEntries,
      });
      setError(
        `✓ ${roleHit ? memberLabel(roleHit.member) : "Member"} → ${roleCn}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  // Candidate list for the leader picker: the curated roster from the
  // server, plus everyone else enrolled synthesised from the payload the
  // page already holds (so widening past the roster costs no extra bytes
  // on the wire). Roster entries win on collision — they carry the
  // per-event tier/grade overrides and core traits.
  const leaderCandidates: GroupBuilderLeaderCandidate[] = useMemo(() => {
    const byId = new Map<string, GroupBuilderLeaderCandidate>();
    for (const c of props.zuZhangRoster) byId.set(c.participant_id, c);
    for (const g of viewGroups) {
      for (const m of g.members) {
        if (byId.has(m.participant_id)) continue;
        byId.set(m.participant_id, {
          participant_id: m.participant_id,
          region_id: m.region_id,
          name_en: m.name_en,
          name_cn: m.name_cn,
          is_old_student: m.is_old_student,
          serving: false,
          tier: m.zu_zhang_tier,
          grade: m.zu_zhang_grade,
          dimensions: m.zu_zhang_dimensions,
          core_traits: [],
          times_led_groups: m.times_led_groups,
          current_group_no: g.group_no,
          current_role: m.role,
        });
      }
    }
    for (const u of view.unassigned) {
      if (byId.has(u.participant_id)) continue;
      byId.set(u.participant_id, {
        participant_id: u.participant_id,
        region_id: u.region_id,
        name_en: u.name_en,
        name_cn: u.name_cn,
        is_old_student: u.is_old_student,
        serving: false,
        tier: u.zu_zhang_tier,
        // The unassigned chip payload is deliberately lightweight — these
        // only populate for roster members and seated participants.
        grade: null,
        dimensions: [],
        core_traits: [],
        times_led_groups: 0,
        current_group_no: null,
        current_role: null,
      });
    }
    return [...byId.values()];
  }, [props.zuZhangRoster, viewGroups, view.unassigned]);

  const pickGroup = leaderPick
    ? (viewGroups.find((g) => g.id === leaderPick.groupId) ?? null)
    : null;

  async function handleAssignLeader(
    groupId: string,
    participantId: string,
    role: LeaderRole,
  ) {
    setError(null);
    // Both the target group (its incumbent may be displaced) and wherever
    // the pick is coming from.
    const leaderEntries = captureSnapshot(
      [participantId],
      [groupId, byParticipant.get(participantId)?.groupId ?? null],
    );
    setOverlay([
      ...demotedIncumbent(groupId, role, participantId),
      { participant_id: participantId, group_id: groupId, role },
    ]);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "assign_leader",
            group_id: groupId,
            participant_id: participantId,
            role,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        demoted_participant_id?: string | null;
        from_group_no?: number | null;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Leader assignment failed");
        setOverlay(null);
        return;
      }
      const group = viewGroups.find((g) => g.id === groupId);
      const who =
        leaderCandidates.find((c) => c.participant_id === participantId);
      const name =
        who?.name_cn ?? who?.name_en ?? who?.region_id ?? "Leader";
      const roleCn = role === "zu_zhang" ? "主组长" : "副组长";
      const parts = [`✓ ${roleCn} · #${group?.group_no ?? "?"} → ${name}`];
      if (json.from_group_no != null) {
        parts.push(`moved from #${json.from_group_no}`);
      }
      if (json.demoted_participant_id) {
        const prev = viewGroups
          .flatMap((g) => g.members)
          .find((m) => m.participant_id === json.demoted_participant_id);
        parts.push(
          `${prev ? memberLabel(prev) : "previous holder"} → member`,
        );
      }
      setUndoRecord({ label: parts[0].replace(/^✓ /, ""), entries: leaderEntries });
      setError(parts.join(" · "));
      setLeaderPick(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  // Where each selectable member currently sits, for the bulk bar's
  // summary and the swap precondition.
  const memberIndex = useMemo(() => {
    const idx = new Map<
      string,
      { member: GroupBuilderMember; groupNo: number; groupId: string }
    >();
    for (const g of viewGroups) {
      for (const m of g.members) {
        idx.set(m.assignment_id, {
          member: m,
          groupNo: g.group_no,
          groupId: g.id,
        });
      }
    }
    return idx;
  }, [viewGroups]);

  // Participant-keyed view of the same data, for undo snapshots (which
  // key on participant_id — assignment rows are deleted and recreated by
  // unassign/restore, so their ids don't survive a round trip).
  const byParticipant = useMemo(() => {
    const idx = new Map<string, { groupId: string; role: GroupMemberRole }>();
    for (const g of viewGroups) {
      for (const m of g.members) {
        idx.set(m.participant_id, { groupId: g.id, role: m.role });
      }
    }
    return idx;
  }, [viewGroups]);

  // Predicted demotion: promoting into 主组长 displaces whoever holds it.
  function demotedIncumbent(
    groupId: string | null,
    role: GroupMemberRole,
    incomingPid: string,
  ): UndoEntry[] {
    if (!groupId || role !== "zu_zhang") return [];
    const g = viewGroups.find((x) => x.id === groupId);
    if (!g) return [];
    return g.members
      .filter(
        (m) => m.role === "zu_zhang" && m.participant_id !== incomingPid,
      )
      .map((m) => ({
        participant_id: m.participant_id,
        group_id: groupId,
        role: "participant" as GroupMemberRole,
      }));
  }

  function groupIdOfNo(groupNo: number): string | null {
    return viewGroups.find((g) => g.group_no === groupNo)?.id ?? null;
  }

  // Snapshot the named participants PLUS every member of the named groups.
  // Generous on purpose: moves demote leaders, leader picks displace an
  // incumbent, swaps reset roles — capturing only the people directly
  // acted on would restore them and leave the collateral changes stuck.
  function captureSnapshot(
    participantIds: string[],
    groupIds: Array<string | null> = [],
  ): UndoEntry[] {
    const pids = new Set(participantIds);
    for (const gid of groupIds) {
      if (!gid) continue;
      const g = viewGroups.find((x) => x.id === gid);
      if (g) for (const m of g.members) pids.add(m.participant_id);
    }
    return [...pids].map((pid) => {
      const at = byParticipant.get(pid);
      return {
        participant_id: pid,
        group_id: at?.groupId ?? null,
        role: at?.role ?? ("participant" as GroupMemberRole),
      };
    });
  }

  // A refresh can retire assignment rows out from under the selection —
  // someone else's edit, or our own bulk unassign. Drop the dead ids so a
  // later bulk call never ships a stale one.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set([...prev].filter((id) => memberIndex.has(id)));
      return live.size === prev.size ? prev : live;
    });
  }, [memberIndex]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedGroupNos = useMemo(() => {
    const nos = new Set<number>();
    for (const id of selectedIds) {
      const hit = memberIndex.get(id);
      if (hit) nos.add(hit.groupNo);
    }
    return [...nos].sort((a, b) => a - b);
  }, [selectedIds, memberIndex]);

  // Swap is defined only for two people in two different groups.
  const canSwap = selectedIds.length === 2 && selectedGroupNos.length === 2;
  const swapHint =
    selectedIds.length !== 2
      ? "Select exactly two people to swap."
      : selectedGroupNos.length !== 2
        ? "Both are in the same group — pick one from each."
        : "";

  function toggleMember(assignmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  }

  function toggleGroup(assignmentIds: string[], select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of assignmentIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function bulkPatch(
    payload: Record<string, unknown>,
    describe: (json: {
      affected?: number;
      skipped_locked?: number;
      skipped_group_nos?: number[];
      roles_preserved?: boolean;
      a_to_group_no?: number;
      b_to_group_no?: number;
    }) => string,
    failMsg: string,
    undo?: UndoRecord,
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        affected?: number;
        skipped_locked?: number;
        skipped_group_nos?: number[];
        roles_preserved?: boolean;
        a_to_group_no?: number;
        b_to_group_no?: number;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? failMsg);
        setOverlay(null);
        return;
      }
      setError(describe(json));
      if (undo) setUndoRecord(undo);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  // Participant ids + every group in play, resolved before the write.
  function bulkSnapshot(extraGroupIds: Array<string | null> = []): UndoEntry[] {
    const pids: string[] = [];
    const groupIds: Array<string | null> = [...extraGroupIds];
    for (const id of selectedIds) {
      const hit = memberIndex.get(id);
      if (!hit) continue;
      pids.push(hit.member.participant_id);
      groupIds.push(hit.groupId);
    }
    return captureSnapshot(pids, groupIds);
  }

  async function handleBulkMove(toGroupNo: number) {
    const entries = bulkSnapshot([groupIdOfNo(toGroupNo)]);
    const n = selectedIds.length;
    const moveTarget = groupIdOfNo(toGroupNo);
    setOverlay(
      selectedIds
        .map((id) => memberIndex.get(id))
        .filter((h): h is NonNullable<typeof h> => !!h)
        .map((h) => ({
          participant_id: h.member.participant_id,
          group_id: moveTarget,
          role: "participant" as GroupMemberRole,
        })),
    );
    await bulkPatch(
      {
        action: "bulk_move",
        assignment_ids: selectedIds,
        to_group_no: toGroupNo,
      },
      (json) => {
        const moved = json.affected ?? 0;
        const parts = [`✓ Moved ${moved} → #${toGroupNo}`];
        if (json.skipped_group_nos?.length) {
          parts.push(
            `skipped ${json.skipped_group_nos.map((g) => `#${g}`).join(", ")} (locked)`,
          );
        }
        if (moved > 0) parts.push("roles reset to member");
        return parts.join(" · ");
      },
      "Bulk move failed",
      { label: `Moved ${n} → #${toGroupNo}`, entries },
    );
  }

  async function handleBulkUnassign() {
    const entries = bulkSnapshot();
    const n = selectedIds.length;
    setOverlay(
      selectedIds
        .map((id) => memberIndex.get(id))
        .filter((h): h is NonNullable<typeof h> => !!h)
        .map((h) => ({
          participant_id: h.member.participant_id,
          group_id: null,
          role: "participant" as GroupMemberRole,
        })),
    );
    await bulkPatch(
      { action: "bulk_remove", assignment_ids: selectedIds },
      (json) => {
        const affected = json.affected ?? 0;
        const parts = [`✓ Unassigned ${affected}`];
        if (json.skipped_group_nos?.length) {
          parts.push(
            `skipped ${json.skipped_group_nos.map((g) => `#${g}`).join(", ")} (locked)`,
          );
        }
        return parts.join(" · ");
      },
      "Bulk unassign failed",
      { label: `Unassigned ${n}`, entries },
    );
  }

  async function handleSwap() {
    if (!canSwap) return;
    const [idA, idB] = selectedIds;
    const a = memberIndex.get(idA);
    const b = memberIndex.get(idB);
    const entries = bulkSnapshot();
    if (a && b) {
      // Mirrors the server rule: roles survive only when both sides hold
      // the same one.
      const same = a.member.role === b.member.role;
      setOverlay([
        {
          participant_id: a.member.participant_id,
          group_id: b.groupId,
          role: same ? a.member.role : "participant",
        },
        {
          participant_id: b.member.participant_id,
          group_id: a.groupId,
          role: same ? b.member.role : "participant",
        },
      ]);
    }
    await bulkPatch(
      { action: "swap", assignment_id_a: idA, assignment_id_b: idB },
      (json) => {
        const nameA = a ? memberLabel(a.member) : "A";
        const nameB = b ? memberLabel(b.member) : "B";
        const parts = [
          `✓ Swapped ${nameA} ⇄ ${nameB} (#${a?.groupNo} ⇄ #${b?.groupNo})`,
        ];
        parts.push(
          json.roles_preserved
            ? "roles kept"
            : "mixed roles — both reset to member",
        );
        return parts.join(" · ");
      },
      "Swap failed",
      {
        label: `Swapped ${a ? memberLabel(a.member) : "A"} ⇄ ${
          b ? memberLabel(b.member) : "B"
        }`,
        entries,
      },
    );
  }

  async function handleUndo() {
    if (!undoRecord || busy) return;
    const record = undoRecord;
    setOverlay(record.entries);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${props.eventId}/groups/members`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "restore_snapshot",
            entries: record.entries,
            label: record.label,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        restored?: number;
        unassigned?: number;
        dropped_missing_group?: number;
        skipped_group_nos?: number[];
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Undo failed");
        setOverlay(null);
        return;
      }
      const parts = [`✓ Undone · ${record.label}`];
      if (json.skipped_group_nos?.length) {
        parts.push(
          `skipped ${json.skipped_group_nos.map((g) => `#${g}`).join(", ")} (locked)`,
        );
      }
      if (json.dropped_missing_group) {
        parts.push(`${json.dropped_missing_group} group(s) no longer exist`);
      }
      // No undo-of-undo — a second stack level is where this stops being
      // predictable.
      setUndoRecord(null);
      setError(parts.join(" · "));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!props.canGenerate) return;
    if (busy) return;
    const confirmMsg = viewGroups.length > 0
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
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  }

  const totalGroups = viewGroups.length;
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
        {props.canEdit && props.mode === "tables" ? (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] tracking-[0.04em] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
            aria-label="Import edited grouping spreadsheet"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 10.5v-6M3.5 7L6 4.5 8.5 7" />
              <path d="M2 2.5V2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v0.5" />
            </svg>
            Import Excel
          </button>
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

      {importOpen ? (
        <GroupsImportDialog
          eventId={props.eventId}
          onClose={() => setImportOpen(false)}
          onApplied={() => {
            setImportOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {leaderPick && pickGroup ? (
        <LeaderPickerDialog
          groupNo={pickGroup.group_no}
          groupClass={pickGroup.group_class}
          groupLabel={
            pickGroup.name_cn
            ?? pickGroup.name_en
            ?? GROUP_CLASS_LABEL[pickGroup.group_class].cn
          }
          initialRole={leaderPick.role}
          candidates={leaderCandidates}
          groupGoals={pickGroup.members
            .map((m) => m.goal_dimensions[0])
            .filter((d): d is GrowthDimension => !!d)}
          currentHolders={{
            zu_zhang:
              pickGroup.members.find((m) => m.role === "zu_zhang")
                ?.participant_id ?? null,
            // Several 副组长 per group is normal, so this is a list.
            fu_zu_zhang: pickGroup.members
              .filter((m) => m.role === "fu_zu_zhang")
              .map((m) => m.participant_id),
          }}
          onPick={(participantId, role) =>
            handleAssignLeader(pickGroup.id, participantId, role)
          }
          onClose={() => setLeaderPick(null)}
        />
      ) : null}

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

      {/* Floating toast — fixed so a rejected move/add is visible no matter
          where on the page the admin acted (a group card can be scrolled far
          below the old top-of-page banner). Success messages start with ✓.
          Rides above the bulk bar when a selection is live. */}
      {error ? (
        <div
          role="status"
          className={`fixed ${
            selected.size > 0 ? "bottom-[76px]" : "bottom-6"
          } left-1/2 -translate-x-1/2 z-[70] max-w-[92vw] flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-2.5 text-[12.5px] shadow-[var(--shadow-elevated)] ${
            error.startsWith("✓")
              ? "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)]"
              : "border-[var(--cinnabar)]/50 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          }`}
        >
          <span>{error}</span>
          {undoRecord ? (
            <button
              type="button"
              onClick={handleUndo}
              disabled={busy}
              className="inline-flex items-center h-[24px] px-2.5 rounded-[var(--radius-pill)] border border-current/35 text-[11.5px] tracking-[0.04em] hover:bg-current/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              ↩ Undo · 撤销
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setUndoRecord(null);
            }}
            className="text-current/70 hover:text-current text-[14px] leading-none"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      {props.mode === "cushions" ? (
        <CushionPreview cushions={props.cushions} />
      ) : totalGroups === 0 ? (
        <EmptyState enrolmentCount={props.enrolmentCount} canGenerate={props.canGenerate} />
      ) : (
        <>
          {props.canEdit ? (
            <UnassignedPool
              items={view.unassigned}
              onAdd={handleAddMember}
              groupNos={viewGroups.map((g) => g.group_no)}
            />
          ) : null}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {viewGroups.map((g) => (
              <GroupCard
                key={g.id}
                eventId={props.eventId}
                group={g}
                groupSizeMax={props.groupSizeMax}
                groupSizeMin={props.groupSizeMin}
                canEdit={props.canEdit}
                groupNos={viewGroups.map((g) => g.group_no)}
                onMove={handleAddMemberMove}
                onRemove={handleRemoveMember}
                onSetRole={handleSetRole}
                onSetClass={handleSetClass}
                onSetPin={handleSetPin}
                onSetName={handleSetName}
                onSetLocked={handleSetLocked}
                onResetToAuto={handleResetToAuto}
                onDeleteGroup={handleDeleteGroup}
                onSetQualification={handleSetQualification}
                onPickLeader={(role) =>
                  setLeaderPick({ groupId: g.id, role })
                }
                selectedIds={selected}
                onToggleMember={toggleMember}
                onToggleGroup={toggleGroup}
                openMemberId={openMemberId}
                setOpenMemberId={setOpenMemberId}
                expandedMemberId={expandedMemberId}
                setExpandedMemberId={setExpandedMemberId}
              />
            ))}
          </div>
          {props.canEdit && props.mode === "tables" ? (
            <div className="mt-4">
              <AddGroupButton onAdd={handleAddGroup} disabled={busy} />
            </div>
          ) : null}
          {props.canEdit && selected.size > 0 ? (
            <GroupsBulkBar
              count={selected.size}
              groupNos={selectedGroupNos}
              allGroupNos={viewGroups.map((g) => g.group_no)}
              canSwap={canSwap}
              swapHint={swapHint}
              busy={busy}
              onMove={handleBulkMove}
              onUnassign={handleBulkUnassign}
              onSwap={handleSwap}
              onClear={() => setSelected(new Set())}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function UnassignedPool({
  items,
  onAdd,
  groupNos,
}: {
  items: GroupBuilderUnassigned[];
  onAdd: (participantId: string, toGroupNo: number) => Promise<void>;
  groupNos: number[];
}) {
  return (
    <section className="mb-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/40 p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Unassigned · 未编排
        </span>
        <span className="text-[11px] tabular-nums text-[var(--ink-soft)]">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11.5px] text-[var(--ink-faint)]">
          Everyone is assigned. Use a member&rsquo;s menu → Unassign to move them here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((p) => (
            <UnassignedChip
              key={p.participant_id}
              p={p}
              onAdd={onAdd}
              groupNos={groupNos}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnassignedChip({
  p,
  onAdd,
  groupNos,
}: {
  p: GroupBuilderUnassigned;
  onAdd: (participantId: string, toGroupNo: number) => Promise<void>;
  groupNos: number[];
}) {
  const [picking, setPicking] = useState(false);
  const name = p.name_cn ?? p.name_en ?? p.region_id ?? "—";
  const qual = p.qualification
    ? STUDENT_QUALIFICATION_LABEL[p.qualification].short_cn
    : null;
  return (
    <span className="inline-flex items-center gap-1.5 h-[24px] pl-2 pr-1 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink)]">
      <span className="inline-flex items-center gap-1.5">
        {qual ? (
          <span className="text-[9px] text-[var(--cinnabar-deep)]">{qual}</span>
        ) : null}
        <span>{name}</span>
        {p.region_id ? (
          <span className="text-[10px] tabular-nums text-[var(--ink-faint)]">
            {p.region_id}
          </span>
        ) : null}
        {p.is_old_student ? (
          <span className="text-[9px] text-[var(--gold-deep)]">旧</span>
        ) : null}
      </span>
      {groupNos.length > 0 ? (
        picking ? (
          <select
            autoFocus
            defaultValue=""
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onAdd(p.participant_id, n);
              setPicking(false);
            }}
            onBlur={() => setPicking(false)}
            className="h-[18px] text-[10px] rounded bg-[var(--paper-deep)] border border-[var(--paper-shadow)]"
          >
            <option value="" disabled>
              → #
            </option>
            {groupNos.map((n) => (
              <option key={n} value={n}>
                #{n}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPicking(true)}
            className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-colors"
            title="Add to a group"
            aria-label={`Add ${name} to a group`}
          >
            +
          </button>
        )
      ) : null}
    </span>
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
  onSetName,
  onSetLocked,
  onResetToAuto,
  onDeleteGroup,
  onSetQualification,
  onPickLeader,
  selectedIds,
  onToggleMember,
  onToggleGroup,
  onMove,
  onRemove,
  groupNos,
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
  groupNos: number[];
  onMove: (assignmentId: string, toGroupNo: number) => Promise<void>;
  onRemove: (assignmentId: string) => Promise<void>;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
  onSetClass: (groupId: string, groupClass: GroupClass) => Promise<void>;
  onSetPin: (
    enrollmentId: string,
    pinnedGroupNo: number | null,
  ) => Promise<void>;
  onSetName: (groupId: string, nameEn: string, nameCn: string) => Promise<void>;
  onSetLocked: (groupId: string, locked: boolean) => Promise<void>;
  onResetToAuto: (groupId: string) => Promise<void>;
  onDeleteGroup: (groupId: string, groupNo: number) => Promise<void>;
  onSetQualification: (
    participantId: string,
    qualification: StudentQualification | null,
  ) => Promise<void>;
  onPickLeader: (role: LeaderRole) => void;
  selectedIds: Set<string>;
  onToggleMember: (assignmentId: string) => void;
  onToggleGroup: (assignmentIds: string[], select: boolean) => void;
  openMemberId: string | null;
  setOpenMemberId: (id: string | null) => void;
  expandedMemberId: string | null;
  setExpandedMemberId: (id: string | null) => void;
}) {
  const router = useRouter();
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
  // A locked group refuses leader writes server-side, so don't offer the
  // picker there — unlock is the deliberate first step.
  const canPickLeader = canEdit && !group.locked;

  const selectedHere = group.members.filter((m) =>
    selectedIds.has(m.assignment_id),
  ).length;
  const allSelected =
    group.members.length > 0 && selectedHere === group.members.length;
  const someSelected = selectedHere > 0;

  // Family co-occurrence — allowed for manual placement, but flagged. A
  // member is "family together" when one of their family-partner region_ids
  // is also present in this same group.
  const groupRegionSet = new Set(
    group.members.map((m) => m.region_id).filter((r): r is string => !!r),
  );
  const familyTogether = group.members.filter((m) =>
    m.family_partner_region_ids.some((r) => groupRegionSet.has(r)),
  );

  // Suspected duplicate people. Unlike family, the twin's location doesn't
  // matter — the same person being in the event twice is the problem.
  const duplicated = group.members.filter(
    (m) => m.duplicate_partners.length > 0,
  );

  return (
    <section
      className={`relative rounded-[var(--radius-lg)] border p-4 transition-colors ${
        group.locked
          ? "border-[var(--ink)]/30 bg-[var(--paper-deep)]/50 shadow-[var(--shadow-paper-1)]"
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
          <GroupNameInline
            group={group}
            canEdit={canEdit}
            onSave={(en, cn) => onSetName(group.id, en, cn)}
          />
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
          {canEdit ? (
            <LockToggle
              locked={group.locked}
              onToggle={() => onSetLocked(group.id, !group.locked)}
            />
          ) : group.locked ? (
            <span
              title="Locked from regenerate"
              className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--ink)] text-[var(--paper)] text-[10px]"
              aria-hidden="true"
            >
              🔒
            </span>
          ) : null}
          {group.edited && !group.locked ? (
            <span
              title="Hand-edited — auto-protected from Regenerate. Use 'reset to auto' to hand it back to the algorithm."
              className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/50 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.04em] text-[var(--gold-deep)]"
            >
              手动 · edited
            </span>
          ) : null}
          {!hasZuZhang ? (
            canPickLeader ? (
              <button
                type="button"
                onClick={() => onPickLeader("zu_zhang")}
                className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] text-[9.5px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper)] hover:border-[var(--cinnabar)] focus-visible:ring-1 focus-visible:ring-[var(--cinnabar)] transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
                title="No 组长 seated — pick one from the curated roster."
              >
                missing 主组长 +
              </button>
            ) : (
              <span
                className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] text-[9.5px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
                title="No 组长 seated. Promote a member or curate one via /enrollments."
              >
                missing 主组长
              </span>
            )
          ) : null}
          {!hasFuZuZhang ? (
            canPickLeader ? (
              <button
                type="button"
                onClick={() => onPickLeader("fu_zu_zhang")}
                className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/45 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.04em] text-[var(--gold-deep)] hover:border-[var(--gold)] hover:bg-[var(--gold)]/25 focus-visible:ring-1 focus-visible:ring-[var(--gold)] transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
                title="No 副组长 seated — pick one from the curated roster."
              >
                missing 副组长 +
              </button>
            ) : (
              <span
                className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/45 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.04em] text-[var(--gold-deep)]"
                title="No 副组长 seated."
              >
                missing 副组长
              </span>
            )
          ) : null}
          {familyTogether.length > 0 ? (
            <span
              className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/55 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.04em] text-[var(--gold-deep)]"
              title={`Family members placed together (allowed manually, but the auto-generator avoids it): ${familyTogether
                .map((m) => m.region_id ?? memberLabel(m))
                .join(", ")}`}
            >
              ⚠ 家人同组 · family
            </span>
          ) : null}
          {duplicated.length > 0 ? (
            <span
              className="inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/55 bg-[var(--cinnabar-wash)] text-[9.5px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
              title={`Same person appears more than once in this event (matched on phone/email). Merge or drop the extra record before finalising: ${duplicated
                .map(
                  (m) =>
                    `${m.region_id ?? memberLabel(m)} ↔ ${m.duplicate_partners
                      .map(
                        (d) =>
                          `${d.region_id ?? d.label}${
                            d.group_no ? ` (#${d.group_no})` : " (unassigned)"
                          }`,
                      )
                      .join(", ")}`,
                )
                .join(" · ")}`}
            >
              ⧉ 疑似重复 · duplicate
            </span>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-3">
          {canPickLeader ? (
            <button
              type="button"
              onClick={() => onPickLeader(hasZuZhang ? "fu_zu_zhang" : "zu_zhang")}
              className="text-[10.5px] tracking-[0.04em] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] transition-colors"
              title="Pick 主组长 / 副组长 from the curated roster"
            >
              pick 组长
            </button>
          ) : null}
          {canEdit && group.edited && !group.locked ? (
            <button
              type="button"
              onClick={() => onResetToAuto(group.id)}
              className="text-[10.5px] tracking-[0.04em] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] transition-colors"
              title="Clear the hand-edited flag so the next Regenerate can rebuild this group."
            >
              reset to auto
            </button>
          ) : null}
          {canEdit && group.members.length === 0 ? (
            <button
              type="button"
              onClick={() => onDeleteGroup(group.id, group.group_no)}
              className="text-[10.5px] tracking-[0.04em] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] transition-colors"
              title={`Delete group #${group.group_no}`}
            >
              delete group
            </button>
          ) : null}
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
        // overflow-visible (was overflow-hidden) so the row's role popover
        // can extend past the table for rows near the bottom of the card.
        // The role popover is now ~280px tall after Pass 2 added the
        // qualification submenu — without overflow-visible the bottom rows'
        // popovers got clipped below the card.
        <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)]/60">
          <table className="w-full text-[11.5px]">
            <thead className="bg-[var(--paper-deep)]/40 border-b border-[var(--paper-shadow)]/60 text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              <tr>
                {canEdit ? (
                  <th className="text-left px-1.5 py-1.5 font-medium w-[22px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        // Partial selection reads as neither on nor off.
                        if (el) el.indeterminate = someSelected && !allSelected;
                      }}
                      onChange={(e) =>
                        onToggleGroup(
                          group.members
                            .map((m) => m.assignment_id)
                            .filter((id) => !id.startsWith("optimistic:")),
                          e.target.checked,
                        )
                      }
                      className="accent-[var(--cinnabar)] align-middle cursor-pointer"
                      aria-label={`Select all in group ${group.group_no}`}
                      title={`Select all in #${group.group_no}`}
                    />
                  </th>
                ) : null}
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
              {sortMembers(group.members).map((m, rowIndex, arr) => (
                <MemberRow
                  key={m.assignment_id}
                  member={m}
                  groupClass={group.group_class}
                  groupNo={group.group_no}
                  groupNos={groupNos}
                  familyInGroup={m.family_partner_region_ids.filter((r) =>
                    groupRegionSet.has(r),
                  )}
                  canEdit={canEdit}
                  isSelected={selectedIds.has(m.assignment_id)}
                  onToggleSelect={onToggleMember}
                  // Flip popover upward when the row is in the bottom
                  // half — otherwise the qualification submenu (~280px
                  // tall) extends past the card.
                  popoverFlipUp={rowIndex >= arr.length - 5}
                  onSetRole={onSetRole}
                  onSetPin={onSetPin}
                  onSetQualification={onSetQualification}
                  onMove={onMove}
                  onRemove={onRemove}
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
  groupNos,
  familyInGroup,
  canEdit,
  isSelected,
  onToggleSelect,
  popoverFlipUp,
  onSetRole,
  onSetPin,
  onSetQualification,
  onMove,
  onRemove,
  isOpen,
  setOpen,
  isExpanded,
  setExpanded,
}: {
  member: GroupBuilderMember;
  groupClass: GroupClass;
  groupNo: number;
  groupNos: number[];
  // Region IDs of this member's family partners who are ALSO in this group
  // (empty = none). Non-empty highlights the row + shows a 家人 marker.
  familyInGroup: string[];
  canEdit: boolean;
  isSelected: boolean;
  onToggleSelect: (assignmentId: string) => void;
  popoverFlipUp: boolean;
  onSetRole: (assignmentId: string, role: GroupMemberRole) => Promise<void>;
  onSetPin: (
    enrollmentId: string,
    pinnedGroupNo: number | null,
  ) => Promise<void>;
  onSetQualification: (
    participantId: string,
    qualification: StudentQualification | null,
  ) => Promise<void>;
  onMove: (assignmentId: string, toGroupNo: number) => Promise<void>;
  onRemove: (assignmentId: string) => Promise<void>;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  isExpanded: boolean;
  setExpanded: (v: boolean) => void;
}) {
  const name = memberLabel(member);
  // Row that only exists in the optimistic overlay — its assignment_id is
  // a placeholder, so acting on it would 404. Inert until reconciliation.
  const isPending = member.assignment_id.startsWith("optimistic:");
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
  const hasFamilyHere = familyInGroup.length > 0;

  return (
    <>
      <tr
        data-member-row={member.assignment_id}
        className={`relative border-b border-[var(--paper-shadow)]/40 last:border-b-0 ${roleTone} ${
          hasFamilyHere ? "ring-1 ring-inset ring-[var(--gold)]/60 bg-[var(--gold-soft)]/30" : ""
        } ${
          isSelected
            ? "ring-1 ring-inset ring-[var(--cinnabar)]/55 bg-[var(--cinnabar-wash)]/45"
            : ""
        } ${
          canEdit ? "cursor-pointer hover:bg-[var(--paper-deep)]/35" : ""
        }`}
        title={
          canEdit
            ? "Click to set role / move / unassign / pin"
            : undefined
        }
        onClick={(e) => {
          if (!canEdit || isPending) return;
          e.stopPropagation();
          setOpen(!isOpen);
        }}
      >
        {canEdit ? (
          // Checkbox owns its own click so ticking someone for a bulk
          // action never also pops their role menu open.
          <td
            className="px-1.5 py-1.5 align-middle"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={isPending}
              onChange={() => onToggleSelect(member.assignment_id)}
              onPointerDown={(e) => e.stopPropagation()}
              className="accent-[var(--cinnabar)] align-middle cursor-pointer disabled:opacity-40"
              aria-label={`Select ${name}`}
            />
          </td>
        ) : null}
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
          <span className="inline-flex items-center gap-1.5">
            {name}
            {hasFamilyHere ? (
              <span
                className="inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--gold)]/60 bg-[var(--gold-soft)] text-[8.5px] tracking-[0.04em] text-[var(--gold-deep)]"
                title={`Family with ${familyInGroup.join(", ")} in this group`}
              >
                👪 家人
              </span>
            ) : null}
            {member.duplicate_partners.length > 0 ? (
              <span
                className="inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/60 bg-[var(--cinnabar-wash)] text-[8.5px] tracking-[0.04em] text-[var(--cinnabar-deep)]"
                title={`Looks like the same person as ${member.duplicate_partners
                  .map(
                    (d) =>
                      `${d.region_id ?? d.label}${
                        d.group_no ? ` in #${d.group_no}` : " (unassigned)"
                      } — same ${d.matched_on}`,
                  )
                  .join("; ")}`}
              >
                ⧉ 重复
              </span>
            ) : null}
          </span>
        </td>
        <td className="px-2 py-1.5 align-middle">
          {isLeader && member.zu_zhang_tier ? (
            <TierBadge tier={member.zu_zhang_tier} grade={member.zu_zhang_grade} />
          ) : member.qualification ? (
            <QualChip
              qualification={member.qualification}
              mismatch={classMismatch}
              groupClass={groupClass}
            />
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
              className={`absolute z-10 right-2 flex flex-col rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] text-[11px] max-h-[320px] overflow-y-auto ${
                popoverFlipUp ? "bottom-full mb-1" : "mt-1"
              }`}
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
              {groupNos.length > 1 ? (
                <>
                  <span className="border-t border-[var(--paper-shadow)]/60" />
                  <div className="px-2.5 py-1 flex items-center gap-1.5">
                    <span className="text-[var(--ink-mute)] whitespace-nowrap">
                      Move to · 移至
                    </span>
                    <select
                      defaultValue=""
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        const n = Number(e.target.value);
                        setOpen(false);
                        if (Number.isFinite(n) && n > 0 && n !== groupNo) {
                          await onMove(member.assignment_id, n);
                        }
                      }}
                      className="h-[20px] text-[11px] rounded bg-[var(--paper)] border border-[var(--paper-shadow)]"
                    >
                      <option value="" disabled>
                        #…
                      </option>
                      {groupNos
                        .filter((n) => n !== groupNo)
                        .map((n) => (
                          <option key={n} value={n}>
                            #{n}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              ) : null}
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  setOpen(false);
                  await onRemove(member.assignment_id);
                }}
                className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] text-[var(--ink-mute)] whitespace-nowrap"
              >
                Unassign · 移出
              </button>
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
              <span className="border-t border-[var(--paper-shadow)]/60" />
              <span
                className="px-2.5 py-1 text-[9.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]"
                title="Sets participants.student_qualification (global override)."
              >
                Qualification · 等级
              </span>
              {(
                ["strategic", "excellence", "elite", "rising", "basic"] as StudentQualification[]
              ).map((q) => {
                const active = member.qualification_override === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setOpen(false);
                      await onSetQualification(member.participant_id, q);
                    }}
                    className={`px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] whitespace-nowrap ${
                      active
                        ? "text-[var(--cinnabar-deep)]"
                        : "text-[var(--ink)]"
                    }`}
                  >
                    {active ? "✓ " : "  "}
                    {STUDENT_QUALIFICATION_LABEL[q].cn} · {STUDENT_QUALIFICATION_LABEL[q].en}
                  </button>
                );
              })}
              {member.qualification_override ? (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setOpen(false);
                    await onSetQualification(member.participant_id, null);
                  }}
                  className="px-2.5 py-1 text-left hover:bg-[var(--paper-deep)] text-[var(--ink-mute)] whitespace-nowrap"
                >
                  Clear override · 还原
                </button>
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
          <td colSpan={canEdit ? 8 : 7} className="px-3 py-2.5">
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

function GroupNameInline({
  group,
  canEdit,
  onSave,
}: {
  group: GroupBuilderGroup;
  canEdit: boolean;
  onSave: (nameEn: string, nameCn: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [en, setEn] = useState(group.name_en ?? "");
  const [cn, setCn] = useState(group.name_cn ?? "");
  const [saving, setSaving] = useState(false);

  // Default display when admin hasn't set a name yet.
  const fallbackEn = `Group ${group.group_no}`;
  const fallbackCn = `组 ${group.group_no}`;
  const displayEn = group.name_en?.trim() || fallbackEn;
  const displayCn = group.name_cn?.trim() || fallbackCn;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!canEdit) return;
          setEn(group.name_en ?? "");
          setCn(group.name_cn ?? "");
          setEditing(true);
        }}
        disabled={!canEdit}
        className={`text-[12px] font-display tracking-[-0.01em] text-[var(--ink)] ${
          canEdit
            ? "hover:text-[var(--cinnabar-deep)] cursor-text"
            : "cursor-default"
        }`}
        title={canEdit ? "Click to rename" : undefined}
      >
        <span>{displayEn}</span>
        {group.name_cn?.trim() || !group.name_en?.trim() ? (
          <span className="ml-1.5 text-[var(--ink-mute)]">· {displayCn}</span>
        ) : null}
      </button>
    );
  }

  async function commit() {
    setSaving(true);
    try {
      await onSave(en.trim(), cn.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      className="inline-flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        value={en}
        onChange={(e) => setEn(e.target.value)}
        placeholder={fallbackEn}
        autoFocus
        maxLength={120}
        className="h-[22px] w-[120px] px-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] font-display"
      />
      <input
        value={cn}
        onChange={(e) => setCn(e.target.value)}
        placeholder={fallbackCn}
        maxLength={120}
        className="h-[22px] w-[100px] px-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] font-display"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        className="text-[10.5px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setEn(group.name_en ?? "");
          setCn(group.name_cn ?? "");
          setEditing(false);
        }}
        className="text-[10.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)]"
      >
        Cancel
      </button>
    </span>
  );
}

function LockToggle({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onToggle();
      }}
      className={`inline-flex items-center justify-center w-[20px] h-[20px] rounded-full border transition-colors ${
        locked
          ? "border-[var(--ink)]/40 bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-soft)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-faint)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]"
      }`}
      title={
        locked
          ? "Locked from regenerate · 解锁 to allow re-generate to overwrite"
          : "Click to lock from regenerate · 锁定不被重新生成"
      }
      aria-pressed={locked}
      aria-label={locked ? "Unlock group from regenerate" : "Lock group from regenerate"}
    >
      <span className="text-[11px] leading-none" aria-hidden="true">
        {locked ? "🔒" : "🔓"}
      </span>
    </button>
  );
}

function AddGroupButton({
  onAdd,
  disabled,
}: {
  onAdd: (groupClass: GroupClass) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-4 py-3 text-[12px] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)]/30 hover:text-[var(--cinnabar-deep)] transition-colors disabled:opacity-50"
      >
        + Add empty group · 添加空组
      </button>
    );
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Pick a class · 选择类型
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)]"
        >
          Cancel
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["strategic", "key", "growth", "maintenance"] as GroupClass[]).map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={async () => {
              setOpen(false);
              await onAdd(c);
            }}
            className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-colors disabled:opacity-50"
          >
            {GROUP_CLASS_LABEL[c].cn} · {GROUP_CLASS_LABEL[c].en}
          </button>
        ))}
      </div>
    </div>
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

function QualChip({
  qualification,
  mismatch,
  groupClass,
}: {
  qualification: StudentQualification;
  mismatch: boolean;
  groupClass: GroupClass;
}) {
  const lab = STUDENT_QUALIFICATION_LABEL[qualification];
  const tone = mismatch
    ? "border-[var(--gold)]/55 bg-[var(--gold-soft)]/60 text-[var(--gold-deep)]"
    : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]";
  const title = mismatch
    ? `${lab.cn} · ${lab.en} — doesn't match ${GROUP_CLASS_LABEL[groupClass].cn}. Override or pin to clear.`
    : `${lab.cn} · ${lab.en}`;
  return (
    <span
      className={`inline-flex items-center h-[16px] px-1.5 rounded-[var(--radius-pill)] border text-[9.5px] tracking-[0.04em] ${tone}`}
      title={title}
    >
      {lab.short_cn}
    </span>
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
