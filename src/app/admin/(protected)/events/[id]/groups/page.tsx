import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { loadGroupBuilder } from "@/lib/grouping/load-groups";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { GroupsClient } from "@/components/admin/groups/GroupsClient";

export const metadata: Metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

type RouteParams = { id: string };

export default async function GroupsPage({
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
  const data = await loadGroupBuilder(supabase, eventId);
  if ("error" in data) {
    if (data.error === "event_not_found") notFound();
    throw new Error(data.error);
  }

  const ev = data.event;
  const title =
    ev.title_en || ev.title_cn
      ? `${ev.title_en ?? ""}${ev.title_en && ev.title_cn ? " · " : ""}${ev.title_cn ?? ""}`
      : ev.slug;

  const isReadOnly =
    admin.role !== "super_admin" && admin.role !== "regional_lead";
  const canGenerate = admin.role === "super_admin";

  return (
    <div>
      <CrumbLabel segment={ev.id} label={title} />
      <div className="flex flex-col gap-3">
        <Link
          href={`/admin/events/${ev.id}`}
          className="inline-flex items-center gap-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] transition-colors w-fit"
          style={{ color: "var(--ink-faint)" }}
        >
          ← Event
        </Link>
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Groups · 小组编排 · {ev.slug}
          </div>
          <h1 className="mt-3 font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-[var(--ink-soft)]">
            <Meta
              label="Mode"
              value={ev.seating_mode === "tables" ? "Tables · 桌子" : "Cushions · 蒲团"}
            />
            <Meta label="Group size" value={`${ev.group_size_min}–${ev.group_size_max}`} />
            <Meta label="Enrolled" value={String(data.enrolment_count)} />
            <Meta label="Groups" value={String(data.groups.length)} />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <GroupsClient
          eventId={ev.id}
          mode={ev.seating_mode}
          groupSizeMin={ev.group_size_min}
          groupSizeMax={ev.group_size_max}
          enrolmentCount={data.enrolment_count}
          groups={data.groups}
          cushions={data.cushions}
          canEdit={!isReadOnly}
          canGenerate={canGenerate}
          rosterShortfalls={data.roster_shortfalls}
          memberCountByClass={data.member_count_by_class}
          kByClass={data.k_by_class}
        />
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="text-[12.5px] tabular-nums text-[var(--ink)]">{value}</span>
    </span>
  );
}
