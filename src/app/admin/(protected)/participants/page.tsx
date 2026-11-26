import type { Metadata } from "next";
import { countUnassigned } from "@/lib/participants/assign-queue";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { FiltersBar } from "@/components/admin/participants/FiltersBar";
import { Pagination } from "@/components/admin/participants/Pagination";
import {
  ParticipantsTable,
  type ParticipantRow,
} from "@/components/admin/participants/ParticipantsTable";
import { participantPriceCategory, BASE_CATEGORY_LABEL } from "@/lib/pricing/tiers";
import {
  applyParticipantFilters,
  applyRoleScope,
  DEFAULT_PAGE_SIZE,
  loadStatusContext,
  parseFilters,
  parsePage,
} from "@/lib/participants-query";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ParticipantsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;

  const filters = parseFilters(sp);
  const page = parsePage(sp);
  const pageSize = DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  const baseSelect =
    "id, region_id, name_cn, name_en, region, email, identity_confidence, financial_score, influence_score, student_qualification, motivations, archived_at, created_at, is_minor, is_old_student, has_checked_in, programme_id, programme_expires_at, segment, assigned_cs_id";

  // Filtered + scoped query
  let q = supabase.from("participants").select(baseSelect, { count: "exact" });
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  const statusCtx = await loadStatusContext(supabase);
  q = applyParticipantFilters(q, filters, statusCtx);
  q = q.range(from, to);

  const { data, count, error } = await q;
  // Student status today — the same rule pricing uses.
  const progById = new Map(statusCtx.programmes.map((p) => [p.id, p]));
  const rows = ((error ? [] : (data ?? [])) as Array<ParticipantRow & {
    is_old_student: boolean | null;
    has_checked_in: boolean | null;
    programme_id: string | null;
    programme_expires_at: string | null;
  }>).map((r) => {
    const prog = r.programme_id ? progById.get(r.programme_id) : undefined;
    const cat = participantPriceCategory({
      programme_slug: prog?.slug ?? null,
      programme_expires_at: r.programme_expires_at,
      is_old_student: r.is_old_student,
      has_attended: r.has_checked_in,
    });
    const label = BASE_CATEGORY_LABEL[cat] ?? { cn: prog?.name_cn ?? cat, en: prog?.name_en ?? cat };
    return { ...r, status_label: label, status_is_member: !BASE_CATEGORY_LABEL[cat] };
  });
  const total = count ?? 0;
  const unassignedCount = admin.role === "super_admin" ? await countUnassigned() : 0;

  // Also fetch unfiltered total for "X of Y matching" meta
  let totalQ = supabase.from("participants").select("id", { count: "exact", head: true });
  totalQ = applyRoleScope(totalQ, admin.role, admin.id, admin.region);
  const { count: scopeTotal } = await totalQ;

  // CS admin list for the "Assign CS" bulk action. Super admins show up too
  // since they can also hold CS responsibilities on small teams.
  const { data: csData } = await supabase
    .from("admins")
    .select("id, name_en, name_cn, role")
    .is("deactivated_at", null)
    .in("role", ["customer_service", "super_admin"])
    .order("name_en", { ascending: true, nullsFirst: false });
  const customerService = (csData ?? []) as {
    id: string;
    name_en: string | null;
    name_cn: string | null;
    role: string;
  }[];

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Student master · 学员
          </div>
          <h1 className="mt-4 font-display text-[40px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Participants
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
            Shared across every event. Student IDs are assigned on registration —
            editable by admins and used for all external references.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {admin.role === "super_admin" ? (
          <>
          <Link
            href="/admin/participants/assign"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       text-[12.5px] tracking-[0.04em] font-medium text-[var(--ink)]
                       hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]
                       active:scale-[0.98]"
          >
            To assign · 待分配
            <span className="tabular-nums text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]">
              {unassignedCount}
            </span>
          </Link>
          <Link
            href="/admin/participants/new"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       text-[12.5px] tracking-[0.04em] font-medium text-[var(--ink)]
                       hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]
                       active:scale-[0.98]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 2v8M2 6h8" />
            </svg>
            New
          </Link>
          <Link
            href="/admin/participants/import"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                       bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] text-[var(--paper-warm)]
                       text-[12.5px] tracking-[0.04em] font-medium
                       shadow-[0_4px_14px_rgba(37,99,235,0.25)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,transform] duration-[var(--dur-fast)]
                       active:scale-[0.98]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 1.5l1.2 2.8L10 5.5l-2.8 1.2L6 9.5 4.8 6.7 2 5.5l2.8-1.2L6 1.5z" />
            </svg>
            AI Import
          </Link>
          </>
          ) : null}

          <div
            className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                       px-5 py-3.5 text-right shadow-[var(--shadow-paper-1)]"
          >
            <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
              {admin.role === "regional_lead" ? `Region · ${admin.region ?? "—"}` : "Total"}
            </div>
            <div className="mt-0.5 font-display text-[28px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
              {(scopeTotal ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        initialQ={filters.q ?? ""}
        activeCount={total}
        totalCount={scopeTotal ?? null}
        initialArchived={filters.archived ?? "active"}
        canExport={admin.role === "super_admin"}
        programmes={statusCtx.programmes.map((p) => ({ slug: p.slug, name_cn: p.name_cn, name_en: p.name_en }))}
        csOptions={admin.role === "super_admin" ? customerService.map((c) => ({ id: c.id, name: c.name_cn || c.name_en || "CS" })) : undefined}
      />

      <ParticipantsTable
        rows={rows}
        adminRole={admin.role}
        hasFilters={Boolean(
          filters.q || filters.region || filters.identity || filters.motivation || filters.status || filters.minors || filters.segment || filters.cs,
        )}
        customerService={customerService}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
