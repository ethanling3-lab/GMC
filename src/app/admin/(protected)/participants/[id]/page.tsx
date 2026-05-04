import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  applyRoleScope,
  type MotivationTag,
  type ParticipantStatus,
} from "@/lib/participants-query";
import { IdentityEditor } from "@/components/admin/participants/detail/IdentityEditor";
import { ScoringEditor } from "@/components/admin/participants/detail/ScoringEditor";
import { StudentCategoryEditor } from "@/components/admin/participants/detail/StudentCategoryEditor";
import { ZuZhangProfileEditor } from "@/components/admin/participants/detail/ZuZhangProfileEditor";
import { EnrichmentEditor } from "@/components/admin/participants/detail/EnrichmentEditor";
import { FaceReadingCard } from "@/components/admin/participants/detail/FaceReadingCard";
import type { FaceMeasurements } from "@/lib/face-reading/archetypes";
import type {
  GrowthDimension,
  ProgrammeTier,
  StudentQualification,
  UpgradePotential,
  ZuZhangCoreTrait,
  ZuZhangTier,
} from "@/lib/grouping/types";
import { NotesEditor } from "@/components/admin/participants/detail/NotesEditor";
import { RelationshipsEditor } from "@/components/admin/participants/detail/RelationshipsEditor";
import { PhotoUploader } from "@/components/admin/participants/detail/PhotoUploader";
import {
  AssignmentEditor,
  type AdminOption,
} from "@/components/admin/participants/detail/AssignmentEditor";
import { StatusEditor } from "@/components/admin/participants/detail/StatusEditor";
import { ActionsCard } from "@/components/admin/participants/detail/ActionsCard";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Participant" };
export const dynamic = "force-dynamic";

type Participant = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language: string | null;
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
  financial_score: number | null;
  influence_score: number | null;
  overall_score: number | null;
  motivation_tag: MotivationTag | null;
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_grade: number | null;
  zu_zhang_dimensions: GrowthDimension[];
  zu_zhang_core_traits: ZuZhangCoreTrait[];
  goal_dimensions: GrowthDimension[];
  student_qualification: StudentQualification | null;
  has_special_contribution: boolean;
  upgrade_potential: UpgradePotential | null;
  times_led_groups: number;
  programme_tier: ProgrammeTier | null;
  is_old_student: boolean;
  family_of_participant_id: string | null;
  referrer_id: string | null;
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
  front_photo_url: string | null;
  face_archetype: string | null;
  face_archetype_suggested: string | null;
  face_measurements:
    | FaceMeasurements
    | { error?: string; diagTips?: string[] }
    | null;
  face_skin_tone_override: string | null;
  face_analyzed_at: string | null;
  face_analysis_error: string | null;
  assigned_region_lead_id: string | null;
  assigned_cs_id: string | null;
  cs_notes: string | null;
  referrer_name: string | null;
  referrer_contact: string | null;
  status: ParticipantStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type RelatedParticipant = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
};

function initials(p: { name_en: string | null; name_cn: string | null }): string {
  const src = (p.name_en ?? p.name_cn ?? "").trim();
  if (!src) return "·";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function combinedName(p: {
  name_en: string | null;
  name_cn: string | null;
}): string {
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REGION_NAME: Record<string, string> = {
  MY: "Malaysia",
  SG: "Singapore",
  TW: "Taiwan",
  HK: "Hong Kong",
  CN: "Mainland China",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ParticipantDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  // Scoped single-record query
  let q = supabase.from("participants").select("*").eq("id", id);
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  const { data, error } = await q.maybeSingle();

  if (error || !data) notFound();
  const p = data as Participant;

  // Fetch related entities + admin options in parallel
  const [familyLinksRes, referrerRes, referredRes, regionLeadsRes, csRes] =
    await Promise.all([
      supabase
        .from("participant_family_links")
        .select("a_id, b_id")
        .or(`a_id.eq.${p.id},b_id.eq.${p.id}`),
      p.referrer_id
        ? supabase
            .from("participants")
            .select("id, region_id, name_en, name_cn")
            .eq("id", p.referrer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("participants")
        .select("id, region_id, name_en, name_cn")
        .eq("referrer_id", p.id)
        .limit(10),
      supabase
        .from("admins")
        .select("id, name_en, name_cn, role, region")
        .in("role", ["regional_lead", "super_admin"]),
      supabase
        .from("admins")
        .select("id, name_en, name_cn, role, region")
        .in("role", ["customer_service", "super_admin"]),
    ]);

  // Resolve the family-link partner IDs into full participant rows.
  const partnerIds = new Set<string>();
  for (const row of (familyLinksRes.data ?? []) as Array<{
    a_id: string;
    b_id: string;
  }>) {
    partnerIds.add(row.a_id === p.id ? row.b_id : row.a_id);
  }
  // Legacy single-edge column — include in the displayed list so the
  // editor surfaces it; saving rewrites the join table only.
  if (p.family_of_participant_id) {
    partnerIds.add(p.family_of_participant_id);
  }
  let familyMembers: RelatedParticipant[] = [];
  if (partnerIds.size > 0) {
    const { data: rows } = await supabase
      .from("participants")
      .select("id, region_id, name_en, name_cn")
      .in("id", Array.from(partnerIds));
    familyMembers = (rows ?? []) as RelatedParticipant[];
  }

  const referrer = referrerRes.data as RelatedParticipant | null;
  const referred = (referredRes.data ?? []) as RelatedParticipant[];
  const regionLeads = (regionLeadsRes.data ?? []) as AdminOption[];
  const customerService = (csRes.data ?? []) as AdminOption[];

  const regionName = p.region ? REGION_NAME[p.region] ?? p.region : null;

  const archived = Boolean(p.archived_at);

  const crumbLabel =
    p.region_id && (p.name_en || p.name_cn)
      ? `${p.region_id} · ${p.name_en ?? p.name_cn}`
      : p.name_en || p.name_cn || p.region_id || p.id.slice(0, 8);

  return (
    <div className="relative">
      <CrumbLabel segment={p.id} label={crumbLabel} />
      {/* Archived banner */}
      {archived ? (
        <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] px-4 py-3 flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]"
            aria-hidden="true"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="10" height="3" rx="0.5" />
              <path d="M3 6v5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
              <path d="M5.5 8.5h3" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-[var(--ink)]">
              Archived
            </div>
            <div className="text-[11.5px] text-[var(--ink-mute)]">
              Hidden from the default list since{" "}
              {new Date(p.archived_at!).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              . Unarchive from the Actions card below.
            </div>
          </div>
        </div>
      ) : null}

      {/* Back */}
      <div className="flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        <Link
          href="/admin/participants"
          className="inline-flex items-center gap-1.5 hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to participants
        </Link>
      </div>

      {/* Hero header */}
      <header className="mt-6 flex items-start justify-between gap-8 flex-wrap">
        <div className="min-w-0 max-w-[720px]">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Participant · 学员
            {p.is_old_student ? (
              <span className="ml-2 px-1.5 py-0.5 rounded-full border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] tracking-[0.14em]">
                Old student · 老学员
              </span>
            ) : null}
          </div>

          <h1 className="mt-4 font-display text-[38px] md:text-[46px] leading-[1.05] tracking-[-0.018em] text-[var(--ink)]">
            {combinedName(p)}
          </h1>

          <div className="mt-5 flex items-center flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-[var(--ink)] bg-[var(--paper)] pl-2 pr-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)]">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]"
                aria-hidden="true"
              />
              {p.region_id ?? "—"}
            </span>
            <StatusEditor participantId={p.id} initial={p.status} />
            {regionName ? (
              <span className="text-[12px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
                {regionName}
              </span>
            ) : null}
          </div>
        </div>

      </header>

      {/* Two-column body */}
      <div className="mt-12 grid lg:grid-cols-[1.65fr_1fr] gap-8">
        {/* MAIN */}
        <div className="flex flex-col gap-6">
          <IdentityEditor
            participantId={p.id}
            initial={{
              region_id: p.region_id,
              name_en: p.name_en,
              name_cn: p.name_cn,
              email: p.email,
              phone: p.phone,
              region: p.region,
              language: p.language,
              gender: p.gender,
              birth_date: p.birth_date,
              occupation: p.occupation,
              industry: p.industry,
            }}
          />

          <StudentCategoryEditor
            participantId={p.id}
            initial={{
              programme_tier: p.programme_tier,
              upgrade_potential: p.upgrade_potential,
            }}
          />

          <ScoringEditor
            participantId={p.id}
            initial={{
              financial_score: p.financial_score,
              influence_score: p.influence_score,
              overall_score: p.overall_score,
              student_qualification: p.student_qualification,
            }}
          />

          <ZuZhangProfileEditor
            participantId={p.id}
            initial={{
              financial_score: p.financial_score,
              influence_score: p.influence_score,
              zu_zhang_tier: p.zu_zhang_tier,
              zu_zhang_grade: p.zu_zhang_grade,
              zu_zhang_dimensions: p.zu_zhang_dimensions ?? [],
              zu_zhang_core_traits: p.zu_zhang_core_traits ?? [],
              has_special_contribution: p.has_special_contribution ?? false,
              times_led_groups: p.times_led_groups ?? 0,
            }}
          />

          <EnrichmentEditor
            participantId={p.id}
            initial={{
              motivation_tag: p.motivation_tag,
              is_old_student: p.is_old_student,
              personality: p.personality,
              face_type: p.face_type,
              parameter_framework: p.parameter_framework,
              goal_dimensions: p.goal_dimensions ?? [],
            }}
          />

          <FaceReadingCard
            participantId={p.id}
            initial={{
              front_photo_url: p.front_photo_url,
              face_archetype: p.face_archetype,
              face_archetype_suggested: p.face_archetype_suggested,
              face_measurements: p.face_measurements,
              face_skin_tone_override: p.face_skin_tone_override,
              face_analyzed_at: p.face_analyzed_at,
              face_analysis_error: p.face_analysis_error,
            }}
          />

          <NotesEditor participantId={p.id} initial={p.cs_notes} />

          <RelationshipsEditor
            participantId={p.id}
            initial={{
              family_members: familyMembers,
              referrer,
              referrer_name: p.referrer_name,
              referrer_contact: p.referrer_contact,
              referred_by_this: referred,
            }}
          />
        </div>

        {/* ASIDE */}
        <aside className="flex flex-col gap-6">
          <PhotoUploader
            participantId={p.id}
            initialUrl={p.front_photo_url}
            initials={initials(p)}
          />

          <AssignmentEditor
            participantId={p.id}
            initial={{
              assigned_region_lead_id: p.assigned_region_lead_id,
              assigned_cs_id: p.assigned_cs_id,
            }}
            regionLeads={regionLeads}
            customerService={customerService}
          />

          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-5 py-4">
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-faint)]">
              Record
            </div>
            <dl className="mt-3 flex flex-col gap-2.5 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-mute)]">Created</dt>
                <dd className="text-[var(--ink)] tabular-nums">
                  {formatDateTime(p.created_at)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-mute)]">Last updated</dt>
                <dd className="text-[var(--ink)] tabular-nums">
                  {formatDateTime(p.updated_at)}
                </dd>
              </div>
              {archived ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--ink-mute)]">Archived</dt>
                  <dd className="text-[var(--ink)] tabular-nums">
                    {formatDateTime(p.archived_at)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <ActionsCard
            participantId={p.id}
            regionIdDisplay={p.region_id}
            archivedAt={p.archived_at}
            canDelete={admin.role === "super_admin"}
          />
        </aside>
      </div>
    </div>
  );
}

