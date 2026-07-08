import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { LayoutEditor } from "@/components/admin/layout/LayoutEditor";
import type {
  FloorPlanAsset,
  GroupClassKey,
  GroupRoster,
  GroupRosterMember,
  SeatRole,
  Shape,
  SquareSeats,
} from "@/components/admin/layout/types";

export const metadata: Metadata = { title: "Floor plan" };
export const dynamic = "force-dynamic";

type RouteParams = { id: string };

type EventRow = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  seating_mode: "tables" | "cushions";
  group_size_min: number;
  group_size_max: number;
};

type ShapeRow = {
  id: string;
  kind: Shape["kind"];
  x_pct: number | string;
  y_pct: number | string;
  width_pct: number | string;
  height_pct: number | string;
  rotation_deg: number | string;
  seat_count: number | null;
  seats_per_side: SquareSeats | null;
  label_en: string | null;
  label_cn: string | null;
  group_id: string | null;
  locked: boolean;
  z_order: number;
};

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

export default async function LayoutPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin"
    && admin.role !== "regional_lead"
    && admin.role !== "instructor"
  ) {
    redirect("/admin");
  }

  const { id: eventId } = await params;
  const supabase = await createSupabaseServerClient();

  // Event meta + shapes + groups + assignments fetched in parallel — none
  // depend on each other.
  type GroupRow = {
    id: string;
    group_no: number;
    group_class: GroupClassKey | null;
    name_en: string | null;
    name_cn: string | null;
  };
  type AssignmentRow = {
    participant_id: string;
    group_id: string | null;
    role: SeatRole;
  };

  type AssetRow = {
    id: string;
    storage_path: string;
    opacity: number | string;
    width_px: number | null;
    height_px: number | null;
    original_filename: string | null;
  };

  const [evRes, shapeRes, groupRes, assignmentRes, assetRes] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, slug, title_en, title_cn, seating_mode, group_size_min, group_size_max",
      )
      .eq("id", eventId)
      .maybeSingle<EventRow>(),
    supabase
      .from("event_floor_plan_shapes")
      .select(
        "id, kind, x_pct, y_pct, width_pct, height_pct, rotation_deg, seat_count, seats_per_side, label_en, label_cn, group_id, locked, z_order",
      )
      .eq("event_id", eventId)
      .order("z_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("event_groups")
      .select("id, group_no, group_class, name_en, name_cn")
      .eq("event_id", eventId)
      .order("group_no", { ascending: true })
      .returns<GroupRow[]>(),
    supabase
      .from("event_seat_assignments")
      .select("participant_id, group_id, role")
      .eq("event_id", eventId)
      .returns<AssignmentRow[]>(),
    supabase
      .from("event_floor_plan_assets")
      .select("id, storage_path, opacity, width_px, height_px, original_filename")
      .eq("event_id", eventId)
      .eq("kind", "background_image")
      .maybeSingle<AssetRow>(),
  ]);

  if (evRes.error) throw new Error(evRes.error.message);
  if (!evRes.data) notFound();
  const ev = evRes.data;

  if (shapeRes.error) throw new Error(shapeRes.error.message);
  if (groupRes.error) throw new Error(groupRes.error.message);
  if (assignmentRes.error) throw new Error(assignmentRes.error.message);

  const shapes: Shape[] = (shapeRes.data ?? []).map((r: ShapeRow) => ({
    id: r.id,
    kind: r.kind,
    x_pct: num(r.x_pct),
    y_pct: num(r.y_pct),
    width_pct: num(r.width_pct),
    height_pct: num(r.height_pct),
    rotation_deg: num(r.rotation_deg),
    seat_count: r.seat_count,
    seats_per_side: r.seats_per_side,
    label_en: r.label_en,
    label_cn: r.label_cn,
    group_id: r.group_id,
    locked: r.locked,
    z_order: r.z_order,
  }));

  // Build per-group rosters in seat order:
  //   zu_zhang → fu_zu_zhang → participant → pai_zhang
  // Ties (multiple at same role) broken by region_id alphabetic for
  // deterministic seat ordering.
  type ParticipantLite = {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    programme_id: string | null;
    programmes:
      | { slug: string | null; abbrev: string | null; name_cn: string | null }
      | { slug: string | null; abbrev: string | null; name_cn: string | null }[]
      | null;
    is_old_student: boolean | null;
    gender: string | null;
    student_qualification: "basic" | "rising" | "elite" | "excellence" | "strategic" | null;
    upgrade_potential: "low" | "medium" | "high" | null;
  };
  const groupRows = groupRes.data ?? [];
  const assignments = assignmentRes.data ?? [];
  const participantIds = Array.from(
    new Set(assignments.map((a) => a.participant_id)),
  );
  let participantById = new Map<string, ParticipantLite>();
  if (participantIds.length > 0) {
    const { data: parts, error: pErr } = await supabase
      .from("participants")
      .select(
        "id, region_id, name_en, name_cn, programme_id, programmes(slug, abbrev, name_cn), is_old_student, gender, student_qualification, upgrade_potential",
      )
      .in("id", participantIds)
      .returns<ParticipantLite[]>();
    if (pErr) throw new Error(pErr.message);
    participantById = new Map((parts ?? []).map((p) => [p.id, p]));
  }

  const ROLE_ORDER: Record<SeatRole, number> = {
    zu_zhang: 0,
    fu_zu_zhang: 1,
    participant: 2,
    pai_zhang: 3,
  };
  const groups: GroupRoster[] = groupRows.map((g) => {
    const members: GroupRosterMember[] = assignments
      .filter((a) => a.group_id === g.id)
      .map((a) => {
        const p = participantById.get(a.participant_id);
        const prog = Array.isArray(p?.programmes) ? p?.programmes[0] : p?.programmes;
        return {
          participant_id: a.participant_id,
          region_id: p?.region_id ?? null,
          name_en: p?.name_en ?? null,
          name_cn: p?.name_cn ?? null,
          role: a.role,
          programme_slug: prog?.slug ?? null,
          programme_abbrev: prog?.abbrev ?? null,
          programme_name_cn: prog?.name_cn ?? null,
          is_old_student: p?.is_old_student === true,
          gender: p?.gender ?? null,
          student_qualification: p?.student_qualification ?? null,
          upgrade_potential: p?.upgrade_potential ?? null,
        };
      })
      .sort((a, b) => {
        const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
        if (r !== 0) return r;
        return (a.region_id ?? "").localeCompare(b.region_id ?? "");
      });
    return {
      id: g.id,
      group_no: g.group_no,
      group_class: g.group_class,
      name_en: g.name_en,
      name_cn: g.name_cn,
      members,
    };
  });

  // Background plan asset — sign URL for the private bucket. createSignedUrl
  // is allowed only with the service role (the SSR user client doesn't have
  // the bucket-level read grant). The TTL covers a long admin session; the
  // editor refetches by reloading the page if the URL ever 401s.
  let initialAsset: FloorPlanAsset | null = null;
  if (assetRes.data) {
    const a = assetRes.data;
    const service = createSupabaseServiceClient();
    const { data: signed } = await service.storage
      .from("event-floor-plans")
      .createSignedUrl(a.storage_path, 60 * 60);
    if (signed?.signedUrl) {
      initialAsset = {
        id: a.id,
        storage_path: a.storage_path,
        opacity: typeof a.opacity === "number" ? a.opacity : Number(a.opacity),
        width_px: a.width_px,
        height_px: a.height_px,
        original_filename: a.original_filename,
        url: signed.signedUrl,
      };
    }
  }

  const title =
    ev.title_en || ev.title_cn
      ? `${ev.title_en ?? ""}${ev.title_en && ev.title_cn ? " · " : ""}${ev.title_cn ?? ""}`
      : ev.slug;

  const canEdit =
    admin.role === "super_admin" || admin.role === "regional_lead";

  return (
    <>
      <CrumbLabel segment={ev.id} label={title} />
      <LayoutEditor
        event={{
          id: ev.id,
          slug: ev.slug,
          title_en: ev.title_en,
          title_cn: ev.title_cn,
          seating_mode: ev.seating_mode,
          group_size_min: ev.group_size_min,
          group_size_max: ev.group_size_max,
        }}
        initialShapes={shapes}
        groups={groups}
        canEdit={canEdit}
        initialAsset={initialAsset}
      />
    </>
  );
}
