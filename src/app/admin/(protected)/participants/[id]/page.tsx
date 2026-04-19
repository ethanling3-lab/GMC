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
import { EnrichmentEditor } from "@/components/admin/participants/detail/EnrichmentEditor";
import { NotesEditor } from "@/components/admin/participants/detail/NotesEditor";
import { PhotoUploader } from "@/components/admin/participants/detail/PhotoUploader";
import {
  AssignmentEditor,
  type AdminOption,
} from "@/components/admin/participants/detail/AssignmentEditor";
import { StatusEditor } from "@/components/admin/participants/detail/StatusEditor";

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
  is_old_student: boolean;
  family_of_participant_id: string | null;
  referrer_id: string | null;
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
  front_photo_url: string | null;
  assigned_region_lead_id: string | null;
  assigned_cs_id: string | null;
  cs_notes: string | null;
  status: ParticipantStatus;
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
  const [familyRes, referrerRes, referredRes, regionLeadsRes, csRes] =
    await Promise.all([
      p.family_of_participant_id
        ? supabase
            .from("participants")
            .select("id, region_id, name_en, name_cn")
            .eq("id", p.family_of_participant_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
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

  const family = familyRes.data as RelatedParticipant | null;
  const referrer = referrerRes.data as RelatedParticipant | null;
  const referred = (referredRes.data ?? []) as RelatedParticipant[];
  const regionLeads = (regionLeadsRes.data ?? []) as AdminOption[];
  const customerService = (csRes.data ?? []) as AdminOption[];

  const regionName = p.region ? REGION_NAME[p.region] ?? p.region : null;

  return (
    <div className="relative">
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

        <aside
          className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                     px-5 py-4 shadow-[var(--shadow-paper-1)] text-right"
        >
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Overall score
          </div>
          <div className="mt-1 font-display text-[36px] leading-[1] tracking-[-0.02em] text-[var(--ink)] tabular-nums">
            {typeof p.overall_score === "number" ? (
              <>
                {p.overall_score}
                <span className="text-[14px] text-[var(--ink-faint)] ml-0.5">/10</span>
              </>
            ) : (
              <span className="text-[var(--ink-faint)] text-[18px]">Unscored</span>
            )}
          </div>
        </aside>
      </header>

      {/* Two-column body */}
      <div className="mt-12 grid lg:grid-cols-[1.65fr_1fr] gap-8">
        {/* MAIN */}
        <div className="flex flex-col gap-6">
          <IdentityEditor
            participantId={p.id}
            regionIdDisplay={p.region_id}
            initial={{
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

          <ScoringEditor
            participantId={p.id}
            initial={{
              financial_score: p.financial_score,
              influence_score: p.influence_score,
              overall_score: p.overall_score,
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
            }}
          />

          <NotesEditor participantId={p.id} initial={p.cs_notes} />

          {/* Relationships (read-only for now) */}
          <section className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-7">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Relationships · 关系
            </div>
            <h2 className="mt-2 font-display text-[18px] leading-[1.25] tracking-[-0.005em] text-[var(--ink)]">
              Family, referrers &amp; referrals
            </h2>

            <dl className="mt-6 grid md:grid-cols-2 gap-x-8 gap-y-5">
              <RelField label="Family of" participant={family} />
              <RelField label="Referred by · 感召" participant={referrer} />
            </dl>

            <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)]">
              <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Referred by this participant · 介绍
              </div>
              {referred.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-[var(--ink-mute)]">None yet.</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {referred.map((r) => (
                    <li key={r.id}>
                      <ParticipantChip p={r} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
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
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RelField({
  label,
  participant,
}: {
  label: string;
  participant: RelatedParticipant | null;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-4 items-baseline">
      <dt className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
        {label}
      </dt>
      <dd>
        {participant ? (
          <ParticipantChip p={participant} />
        ) : (
          <span className="text-[var(--ink-faint)]">—</span>
        )}
      </dd>
    </div>
  );
}

function ParticipantChip({ p }: { p: RelatedParticipant }) {
  const name = combinedName(p);
  return (
    <Link
      href={`/admin/participants/${p.id}`}
      className="inline-flex items-center gap-2 pl-2 pr-3 py-1 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)]
                 text-[12px] text-[var(--ink)]
                 hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                 focus-visible:shadow-[var(--shadow-focus)]
                 transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
    >
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--ink)] text-[var(--paper-warm)] text-[9px] tracking-[0.06em] font-medium"
        aria-hidden="true"
      >
        {initials(p)}
      </span>
      <span className="font-mono text-[11px] text-[var(--ink-mute)]">
        {p.region_id ?? "—"}
      </span>
      <span className="max-w-[180px] truncate">{name}</span>
    </Link>
  );
}
