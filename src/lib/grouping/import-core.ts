import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import {
  GROUP_CLASS_LABEL,
  type GroupClass,
  type GroupMemberRole,
} from "./types";
import type { ParsedGroupingRow } from "./xlsx-import";

// Shared core for the grouping spreadsheet round-trip. `preview` resolves a
// parsed sheet into a desired grouping + a human-readable diff + warnings
// (no writes). `applyGroupingImport` re-validates a confirmed desired state
// and writes it to event_groups + event_seat_assignments.
//
// Model: the uploaded file is the COMPLETE grouping (full-snapshot). Group
// membership + roles round-trip through event_seat_assignments; group class /
// name through event_groups. Every touched group is stamped edited=true so
// the imported grouping survives a later Regenerate (migration 048).

const ROLE_RANK: Record<GroupMemberRole, number> = {
  zu_zhang: 0,
  fu_zu_zhang: 1,
  pai_zhang: 2,
  participant: 3,
};

export type DesiredMember = {
  participant_id: string;
  group_no: number;
  role: GroupMemberRole;
};

export type DesiredGroup = {
  group_no: number;
  group_class: GroupClass;
  name_en: string | null;
  name_cn: string | null;
};

export type DesiredState = {
  groups: DesiredGroup[];
  members: DesiredMember[];
};

export type ImportWarning = {
  severity: "error" | "warn";
  code: string;
  message: string;
  row_index?: number;
  region_id?: string | null;
  participant_id?: string | null;
  group_no?: number | null;
};

export type ImportDiff = {
  moves: Array<{
    participant_id: string;
    label: string;
    from_group_no: number | null;
    to_group_no: number;
  }>;
  role_changes: Array<{
    participant_id: string;
    label: string;
    group_no: number;
    from_role: GroupMemberRole | null;
    to_role: GroupMemberRole;
  }>;
  new_groups: number[];
  removed_groups: number[];
  group_meta_changes: Array<{
    group_no: number;
    field: "class" | "name_en" | "name_cn";
    from: string | null;
    to: string | null;
  }>;
  unassigned: Array<{
    participant_id: string;
    label: string;
    from_group_no: number | null;
  }>;
};

export type ImportPreview = {
  desired_state: DesiredState;
  diff: ImportDiff;
  warnings: ImportWarning[];
  counts: {
    file_rows: number;
    resolved_members: number;
    groups_in_file: number;
  };
  affects_locked: boolean;
};

export type ApplyOptions = {
  override_locked: boolean;
  unassign_missing: boolean;
};

export type ApplyResult = {
  groups_created: number;
  groups_updated: number;
  groups_deleted: number;
  members_moved: number;
  members_unassigned: number;
  leaders_set: number;
  skipped_locked: number;
};

type EnrolledP = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  family_of_participant_id: string | null;
};

type CurrentGroup = {
  id: string;
  group_no: number;
  group_class: GroupClass;
  name_en: string | null;
  name_cn: string | null;
  locked: boolean;
};

type ImportContext = {
  event: {
    group_size_min: number;
    group_size_max: number;
    seating_mode: "tables" | "cushions";
  };
  enrolledById: Map<string, EnrolledP>;
  enrolledByRegion: Map<string, EnrolledP>; // key = region_id uppercased
  currentByPid: Map<string, { group_no: number; role: GroupMemberRole }>;
  groupsByNo: Map<number, CurrentGroup>;
  familyAdj: Map<string, Set<string>>;
  conflictAdj: Map<string, Set<string>>;
};

type Client = ReturnType<typeof createSupabaseServiceClient>;

function labelFor(p: EnrolledP | undefined, fallback: string): string {
  if (!p) return fallback;
  return p.name_cn ?? p.name_en ?? p.region_id ?? fallback;
}

// --------------------------------------------------------------------------
// Context
// --------------------------------------------------------------------------

export async function loadImportContext(
  service: Client,
  eventId: string,
): Promise<ImportContext | { error: string }> {
  const { data: event, error: evErr } = await service
    .from("events")
    .select("group_size_min, group_size_max, seating_mode")
    .eq("id", eventId)
    .maybeSingle<ImportContext["event"]>();
  if (evErr) return { error: evErr.message };
  if (!event) return { error: "event_not_found" };

  // Enrolled population = approved/paid enrolments joined to participants.
  const { data: enrol, error: enErr } = await service
    .from("enrollments")
    .select(
      "participant_id, participants!inner(id, region_id, name_en, name_cn, family_of_participant_id)",
    )
    .eq("event_id", eventId)
    .in("status", ["approved", "paid"])
    .returns<
      Array<{ participant_id: string; participants: EnrolledP }>
    >();
  if (enErr) return { error: enErr.message };

  const enrolledById = new Map<string, EnrolledP>();
  const enrolledByRegion = new Map<string, EnrolledP>();
  for (const row of enrol ?? []) {
    const p = row.participants;
    if (!p) continue;
    enrolledById.set(p.id, p);
    if (p.region_id) enrolledByRegion.set(p.region_id.trim().toUpperCase(), p);
  }

  // Current groups + assignments.
  const { data: groups, error: gErr } = await service
    .from("event_groups")
    .select("id, group_no, group_class, name_en, name_cn, locked")
    .eq("event_id", eventId)
    .returns<CurrentGroup[]>();
  if (gErr) return { error: gErr.message };
  const groupsByNo = new Map<number, CurrentGroup>();
  const groupNoById = new Map<string, number>();
  for (const g of groups ?? []) {
    groupsByNo.set(g.group_no, g);
    groupNoById.set(g.id, g.group_no);
  }

  const { data: assigns, error: aErr } = await service
    .from("event_seat_assignments")
    .select("participant_id, role, group_id")
    .eq("event_id", eventId)
    .returns<
      Array<{ participant_id: string; role: GroupMemberRole; group_id: string | null }>
    >();
  if (aErr) return { error: aErr.message };
  const currentByPid = new Map<string, { group_no: number; role: GroupMemberRole }>();
  for (const a of assigns ?? []) {
    if (!a.group_id) continue;
    const no = groupNoById.get(a.group_id);
    if (no == null) continue;
    currentByPid.set(a.participant_id, { group_no: no, role: a.role });
  }

  // Family + conflict adjacency among the enrolled set (mirrors load-groups).
  const ids = [...enrolledById.keys()];
  const familyAdj = new Map<string, Set<string>>();
  const conflictAdj = new Map<string, Set<string>>();
  const addEdge = (m: Map<string, Set<string>>, a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  };
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (const [table, adj] of [
      ["participant_family_links", familyAdj],
      ["participant_conflict_pairs", conflictAdj],
    ] as const) {
      const respA = await service.from(table).select("a_id, b_id").in("a_id", chunk);
      if (respA.error) return { error: respA.error.message };
      const respB = await service.from(table).select("b_id, a_id").in("b_id", chunk);
      if (respB.error) return { error: respB.error.message };
      for (const l of [...(respA.data ?? []), ...(respB.data ?? [])] as Array<{
        a_id: string;
        b_id: string;
      }>) {
        addEdge(adj, l.a_id, l.b_id);
      }
    }
  }
  // Legacy single-edge family column.
  for (const p of enrolledById.values()) {
    if (p.family_of_participant_id && p.family_of_participant_id !== p.id) {
      addEdge(familyAdj, p.id, p.family_of_participant_id);
    }
  }

  return {
    event,
    enrolledById,
    enrolledByRegion,
    currentByPid,
    groupsByNo,
    familyAdj,
    conflictAdj,
  };
}

// --------------------------------------------------------------------------
// Resolve parsed rows → desired state (+ row-level warnings)
// --------------------------------------------------------------------------

function resolvePid(row: ParsedGroupingRow, ctx: ImportContext): string | null {
  if (row.participant_id && ctx.enrolledById.has(row.participant_id)) {
    return row.participant_id;
  }
  if (row.region_id) {
    const p = ctx.enrolledByRegion.get(row.region_id.trim().toUpperCase());
    if (p) return p.id;
  }
  // A well-formed uuid that isn't enrolled still resolves to itself so the
  // caller can flag "not enrolled" distinctly from "unknown".
  if (row.participant_id) return row.participant_id;
  return null;
}

function buildDesiredState(
  rows: ParsedGroupingRow[],
  ctx: ImportContext,
): { desired: DesiredState; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const members: DesiredMember[] = [];
  const seenPid = new Set<string>();

  // group_no → { classCandidates, name_en, name_cn }
  const groupMeta = new Map<
    number,
    { class_key: GroupClass | null; name_en: string | null; name_cn: string | null }
  >();

  for (const row of rows) {
    const pid = resolvePid(row, ctx);
    if (!pid) {
      warnings.push({
        severity: "error",
        code: "unresolved_participant",
        message: `Row ${row.rowIndex + 2}: no matching participant (blank/unknown Participant ID and Region ID).`,
        row_index: row.rowIndex,
        region_id: row.region_id,
      });
      continue;
    }
    if (!ctx.enrolledById.has(pid)) {
      warnings.push({
        severity: "error",
        code: "not_enrolled",
        message: `Row ${row.rowIndex + 2}: ${row.region_id ?? pid} is not an approved/paid enrolment for this event.`,
        row_index: row.rowIndex,
        participant_id: pid,
        region_id: row.region_id,
      });
      continue;
    }
    if (row.group_no == null) {
      warnings.push({
        severity: "error",
        code: "missing_group_no",
        message: `Row ${row.rowIndex + 2}: ${labelFor(ctx.enrolledById.get(pid), pid)} has no Group #.`,
        row_index: row.rowIndex,
        participant_id: pid,
      });
      continue;
    }
    if (seenPid.has(pid)) {
      warnings.push({
        severity: "error",
        code: "duplicate_participant",
        message: `${labelFor(ctx.enrolledById.get(pid), pid)} appears in more than one row.`,
        row_index: row.rowIndex,
        participant_id: pid,
      });
      continue;
    }
    seenPid.add(pid);
    members.push({ participant_id: pid, group_no: row.group_no, role: row.role_key });

    const meta = groupMeta.get(row.group_no) ?? {
      class_key: null,
      name_en: null,
      name_cn: null,
    };
    if (meta.class_key == null && row.class_key != null) meta.class_key = row.class_key;
    if (meta.name_en == null && row.group_name_en != null) meta.name_en = row.group_name_en;
    if (meta.name_cn == null && row.group_name_cn != null) meta.name_cn = row.group_name_cn;
    groupMeta.set(row.group_no, meta);
  }

  // Resolve each group's class/name: file value → existing group value →
  // default (growth, with a warning only when we truly can't tell).
  const groups: DesiredGroup[] = [];
  for (const [group_no, meta] of [...groupMeta.entries()].sort((a, b) => a[0] - b[0])) {
    const existing = ctx.groupsByNo.get(group_no);
    let group_class = meta.class_key ?? existing?.group_class ?? null;
    if (group_class == null) {
      group_class = "growth";
      warnings.push({
        severity: "warn",
        code: "class_defaulted",
        message: `Group ${group_no}: no recognizable Class — defaulting to 成长组 · Growth.`,
        group_no,
      });
    }
    groups.push({
      group_no,
      group_class,
      name_en: meta.name_en ?? existing?.name_en ?? null,
      name_cn: meta.name_cn ?? existing?.name_cn ?? null,
    });
  }

  // Leader dedup — at most one 组长 per group; demote extras to participant.
  const leaderByGroup = new Map<number, string>();
  for (const m of members) {
    if (m.role !== "zu_zhang") continue;
    if (leaderByGroup.has(m.group_no)) {
      m.role = "participant";
      warnings.push({
        severity: "warn",
        code: "multiple_leaders",
        message: `Group ${m.group_no}: more than one 组长 in the file — keeping the first, demoting the rest.`,
        group_no: m.group_no,
        participant_id: m.participant_id,
      });
    } else {
      leaderByGroup.set(m.group_no, m.participant_id);
    }
  }

  return { desired: { groups, members }, warnings };
}

// --------------------------------------------------------------------------
// Diff + structural warnings
// --------------------------------------------------------------------------

function computeDiffAndWarnings(
  desired: DesiredState,
  ctx: ImportContext,
): { diff: ImportDiff; warnings: ImportWarning[]; affects_locked: boolean } {
  const warnings: ImportWarning[] = [];
  let affectsLocked = false;
  const label = (pid: string) => labelFor(ctx.enrolledById.get(pid), pid);

  const desiredByPid = new Map(desired.members.map((m) => [m.participant_id, m]));
  const desiredGroupNos = new Set(desired.groups.map((g) => g.group_no));
  const membersByGroup = new Map<number, DesiredMember[]>();
  for (const m of desired.members) {
    if (!membersByGroup.has(m.group_no)) membersByGroup.set(m.group_no, []);
    membersByGroup.get(m.group_no)!.push(m);
  }

  const diff: ImportDiff = {
    moves: [],
    role_changes: [],
    new_groups: [],
    removed_groups: [],
    group_meta_changes: [],
    unassigned: [],
  };

  // Moves + role changes.
  for (const m of desired.members) {
    const cur = ctx.currentByPid.get(m.participant_id);
    if (!cur || cur.group_no !== m.group_no) {
      diff.moves.push({
        participant_id: m.participant_id,
        label: label(m.participant_id),
        from_group_no: cur?.group_no ?? null,
        to_group_no: m.group_no,
      });
    }
    if (cur && cur.group_no === m.group_no && cur.role !== m.role) {
      diff.role_changes.push({
        participant_id: m.participant_id,
        label: label(m.participant_id),
        group_no: m.group_no,
        from_role: cur.role,
        to_role: m.role,
      });
    }
  }

  // New vs removed groups.
  for (const no of desiredGroupNos) {
    if (!ctx.groupsByNo.has(no)) diff.new_groups.push(no);
  }
  for (const [no] of ctx.groupsByNo) {
    if (!desiredGroupNos.has(no)) diff.removed_groups.push(no);
  }
  diff.new_groups.sort((a, b) => a - b);
  diff.removed_groups.sort((a, b) => a - b);

  // Group meta changes (existing groups only).
  for (const g of desired.groups) {
    const cur = ctx.groupsByNo.get(g.group_no);
    if (!cur) continue;
    if (cur.group_class !== g.group_class) {
      diff.group_meta_changes.push({
        group_no: g.group_no,
        field: "class",
        from: GROUP_CLASS_LABEL[cur.group_class].en,
        to: GROUP_CLASS_LABEL[g.group_class].en,
      });
    }
    if ((cur.name_en ?? "") !== (g.name_en ?? "")) {
      diff.group_meta_changes.push({
        group_no: g.group_no,
        field: "name_en",
        from: cur.name_en,
        to: g.name_en,
      });
    }
    if ((cur.name_cn ?? "") !== (g.name_cn ?? "")) {
      diff.group_meta_changes.push({
        group_no: g.group_no,
        field: "name_cn",
        from: cur.name_cn,
        to: g.name_cn,
      });
    }
  }

  // Enrolled but missing from the file → will be unassigned (full-snapshot).
  for (const [pid, cur] of ctx.currentByPid) {
    if (!desiredByPid.has(pid) && ctx.enrolledById.has(pid)) {
      diff.unassigned.push({
        participant_id: pid,
        label: label(pid),
        from_group_no: cur.group_no,
      });
    }
  }
  if (diff.unassigned.length > 0) {
    warnings.push({
      severity: "warn",
      code: "unassigned_missing",
      message: `${diff.unassigned.length} enrolled ${diff.unassigned.length === 1 ? "person is" : "people are"} not in the file — they will be unassigned (toggle off "Unassign missing" to keep them).`,
    });
  }

  // Size warnings.
  for (const [no, mem] of membersByGroup) {
    if (mem.length > ctx.event.group_size_max) {
      warnings.push({
        severity: "warn",
        code: "over_max",
        message: `Group ${no} has ${mem.length} people (max is ${ctx.event.group_size_max}).`,
        group_no: no,
      });
    } else if (mem.length < ctx.event.group_size_min) {
      warnings.push({
        severity: "warn",
        code: "under_min",
        message: `Group ${no} has ${mem.length} people (min is ${ctx.event.group_size_min}).`,
        group_no: no,
      });
    }
  }

  // Family / conflict pairs in the same desired group.
  for (const [no, mem] of membersByGroup) {
    const ids = mem.map((m) => m.participant_id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (ctx.familyAdj.get(ids[i])?.has(ids[j])) {
          warnings.push({
            severity: "warn",
            code: "family_together",
            message: `Group ${no}: ${label(ids[i])} and ${label(ids[j])} are family — usually split.`,
            group_no: no,
          });
        }
        if (ctx.conflictAdj.get(ids[i])?.has(ids[j])) {
          warnings.push({
            severity: "warn",
            code: "conflict_together",
            message: `Group ${no}: ${label(ids[i])} and ${label(ids[j])} are a conflict pair — usually split.`,
            group_no: no,
          });
        }
      }
    }
  }

  // Locked groups affected.
  const touchedGroupNos = new Set<number>();
  for (const m of diff.moves) touchedGroupNos.add(m.to_group_no);
  for (const m of diff.moves) if (m.from_group_no != null) touchedGroupNos.add(m.from_group_no);
  for (const u of diff.unassigned) if (u.from_group_no != null) touchedGroupNos.add(u.from_group_no);
  for (const c of diff.group_meta_changes) touchedGroupNos.add(c.group_no);
  for (const no of diff.removed_groups) touchedGroupNos.add(no);
  for (const no of touchedGroupNos) {
    if (ctx.groupsByNo.get(no)?.locked) {
      affectsLocked = true;
      warnings.push({
        severity: "warn",
        code: "locked_group_affected",
        message: `Group ${no} is locked — it will be skipped unless you enable "Override locked groups".`,
        group_no: no,
      });
    }
  }

  return { diff, warnings, affects_locked: affectsLocked };
}

// --------------------------------------------------------------------------
// Public: preview
// --------------------------------------------------------------------------

export function computePreview(
  rows: ParsedGroupingRow[],
  ctx: ImportContext,
): ImportPreview {
  const { desired, warnings: buildWarnings } = buildDesiredState(rows, ctx);
  const { diff, warnings: diffWarnings, affects_locked } = computeDiffAndWarnings(
    desired,
    ctx,
  );
  return {
    desired_state: desired,
    diff,
    warnings: [...buildWarnings, ...diffWarnings],
    counts: {
      file_rows: rows.length,
      resolved_members: desired.members.length,
      groups_in_file: desired.groups.length,
    },
    affects_locked,
  };
}

// --------------------------------------------------------------------------
// Public: apply
// --------------------------------------------------------------------------

export async function applyGroupingImport(
  service: Client,
  eventId: string,
  desired: DesiredState,
  options: ApplyOptions,
): Promise<ApplyResult | { error: string }> {
  const ctxOrErr = await loadImportContext(service, eventId);
  if ("error" in ctxOrErr) return ctxOrErr;
  const ctx = ctxOrErr;

  // Re-validate members: enrolled + dedup (keep the higher-ranked role).
  const bestByPid = new Map<string, DesiredMember>();
  for (const m of desired.members) {
    if (!ctx.enrolledById.has(m.participant_id)) continue;
    const prev = bestByPid.get(m.participant_id);
    if (!prev || ROLE_RANK[m.role] < ROLE_RANK[prev.role]) {
      bestByPid.set(m.participant_id, m);
    }
  }
  const members = [...bestByPid.values()];

  // Locked groups block writes unless overridden.
  const isBlocked = (group_no: number): boolean => {
    const g = ctx.groupsByNo.get(group_no);
    return !!g?.locked && !options.override_locked;
  };

  let skippedLocked = 0;

  // 1. Upsert target groups (skip locked-non-override). Stamp edited=true.
  const groupPayload = desired.groups
    .filter((g) => !isBlocked(g.group_no))
    .map((g) => ({
      event_id: eventId,
      group_no: g.group_no,
      group_class: g.group_class,
      name_en: g.name_en,
      name_cn: g.name_cn,
      edited: true,
    }));
  let groupsCreated = 0;
  let groupsUpdated = 0;
  if (groupPayload.length > 0) {
    const { error: upErr } = await service
      .from("event_groups")
      .upsert(groupPayload, { onConflict: "event_id,group_no" });
    if (upErr) return { error: upErr.message };
    for (const g of groupPayload) {
      if (ctx.groupsByNo.has(g.group_no)) groupsUpdated++;
      else groupsCreated++;
    }
  }

  // 2. Re-read groups to resolve group_no → id (new inserts now have ids).
  const { data: freshGroups, error: fgErr } = await service
    .from("event_groups")
    .select("id, group_no, locked")
    .eq("event_id", eventId)
    .returns<Array<{ id: string; group_no: number; locked: boolean }>>();
  if (fgErr) return { error: fgErr.message };
  const idByNo = new Map<number, string>();
  for (const g of freshGroups ?? []) idByNo.set(g.group_no, g.id);

  // 3. Upsert assignments for each desired member (skip locked-target).
  const assignRows = members
    .filter((m) => !isBlocked(m.group_no) && idByNo.has(m.group_no))
    .map((m) => ({
      event_id: eventId,
      participant_id: m.participant_id,
      group_id: idByNo.get(m.group_no)!,
      role: m.role,
      shape_id: null,
      seat_no: null,
    }));
  skippedLocked += members.length - assignRows.length;
  let membersMoved = 0;
  if (assignRows.length > 0) {
    const { error: aErr } = await service
      .from("event_seat_assignments")
      .upsert(assignRows, { onConflict: "event_id,participant_id" });
    if (aErr) return { error: aErr.message };
    // Count only those whose group actually changed.
    for (const m of members) {
      const cur = ctx.currentByPid.get(m.participant_id);
      if (!isBlocked(m.group_no) && idByNo.has(m.group_no) && (!cur || cur.group_no !== m.group_no)) {
        membersMoved++;
      }
    }
  }

  // 4. Unassign enrolled people missing from the file (unless kept, or their
  //    current group is locked-protected).
  let membersUnassigned = 0;
  if (options.unassign_missing) {
    const desiredPids = new Set(members.map((m) => m.participant_id));
    const toDelete: string[] = [];
    for (const [pid, cur] of ctx.currentByPid) {
      if (desiredPids.has(pid)) continue;
      if (!ctx.enrolledById.has(pid)) continue;
      if (isBlocked(cur.group_no)) {
        skippedLocked++;
        continue;
      }
      toDelete.push(pid);
    }
    if (toDelete.length > 0) {
      const { error: delErr } = await service
        .from("event_seat_assignments")
        .delete()
        .eq("event_id", eventId)
        .in("participant_id", toDelete);
      if (delErr) return { error: delErr.message };
      membersUnassigned = toDelete.length;
    }
  }

  // 5. Set leader_participant_id per group from the zu_zhang member.
  let leadersSet = 0;
  const leaderByNo = new Map<number, string | null>();
  for (const g of desired.groups) {
    if (isBlocked(g.group_no) || !idByNo.has(g.group_no)) continue;
    leaderByNo.set(g.group_no, null);
  }
  for (const m of members) {
    if (m.role === "zu_zhang" && leaderByNo.has(m.group_no)) {
      leaderByNo.set(m.group_no, m.participant_id);
    }
  }
  for (const [no, leaderId] of leaderByNo) {
    const { error: lErr } = await service
      .from("event_groups")
      .update({ leader_participant_id: leaderId })
      .eq("id", idByNo.get(no)!);
    if (lErr) return { error: lErr.message };
    if (leaderId) leadersSet++;
  }

  // 6. Delete removed groups (not in file) that are now empty and unlocked.
  let groupsDeleted = 0;
  const desiredNos = new Set(desired.groups.map((g) => g.group_no));
  const removedCandidates = [...ctx.groupsByNo.values()].filter(
    (g) => !desiredNos.has(g.group_no) && (!g.locked || options.override_locked),
  );
  for (const g of removedCandidates) {
    const { count, error: cErr } = await service
      .from("event_seat_assignments")
      .select("id", { count: "exact", head: true })
      .eq("group_id", g.id);
    if (cErr) return { error: cErr.message };
    if ((count ?? 0) > 0) continue; // still has members (kept-missing) — leave it
    const { error: dErr } = await service
      .from("event_groups")
      .delete()
      .eq("id", g.id);
    if (dErr) return { error: dErr.message };
    groupsDeleted++;
  }

  return {
    groups_created: groupsCreated,
    groups_updated: groupsUpdated,
    groups_deleted: groupsDeleted,
    members_moved: membersMoved,
    members_unassigned: membersUnassigned,
    leaders_set: leadersSet,
    skipped_locked: skippedLocked,
  };
}
