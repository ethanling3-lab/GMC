import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadGroupBuilder } from "@/lib/grouping/load-groups";
import {
  EventGroupReportsClient,
  ExportAllButton,
  type TemplateOption,
} from "@/components/admin/group-reports/EventGroupReportsClient";

export const metadata: Metadata = { title: "Group reports · 小组报告 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EventGroupReportsPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    redirect("/admin/events");
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data: eventRow } = await service
    .from("events")
    .select("id, slug, title_en, title_cn, group_report_template_id")
    .eq("id", id)
    .maybeSingle();
  if (!eventRow) notFound();
  const ev = eventRow as {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    group_report_template_id: string | null;
  };
  const title = ev.title_cn ?? ev.title_en ?? ev.slug;

  const { data: tpls } = await service
    .from("group_report_templates")
    .select("id, name_en, name_cn")
    .eq("active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const templates = (tpls ?? []) as TemplateOption[];

  // Groups + submission status (only meaningful once a template is active).
  const groupData = await loadGroupBuilder(service, id);
  const groups = "error" in groupData ? [] : groupData.groups;

  const { data: subs } = await service
    .from("group_report_submissions")
    .select("group_id, status, submitted_at")
    .eq("event_id", id);
  const statusByGroup = new Map<string, { status: string; submitted_at: string | null }>();
  for (const s of (subs ?? []) as Array<{ group_id: string; status: string; submitted_at: string | null }>) {
    statusByGroup.set(s.group_id, { status: s.status, submitted_at: s.submitted_at });
  }
  const submittedCount = [...statusByGroup.values()].filter((s) => s.status === "submitted").length;

  const canEditTemplate = admin.role === "super_admin" || admin.role === "regional_lead";

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)] flex-wrap">
        <Link href={`/admin/events/${id}`} className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          {title}
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span>Group reports · 小组报告</span>
      </div>
      <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Group reports.
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[64ch]">
        Activate a report template for this event. Group leaders (组长/副组长) fill
        it from their portal, then export every group&apos;s report as one XLSX.
      </p>

      {/* Activate */}
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              Active template · 使用模板
            </div>
            <p className="mt-2 text-[12.5px] text-[var(--ink-mute)]">
              {canEditTemplate ? "Choose which template leaders fill for this event." : "Set by a regional lead / super admin."}
            </p>
          </div>
          <ExportAllButton eventId={ev.id} disabled={!ev.group_report_template_id} />
        </div>
        <div className="mt-4">
          {canEditTemplate ? (
            <EventGroupReportsClient eventId={ev.id} templates={templates} currentTemplateId={ev.group_report_template_id} />
          ) : (
            <div className="text-[13.5px] text-[var(--ink)]">
              {ev.group_report_template_id
                ? templates.find((t) => t.id === ev.group_report_template_id)?.name_cn ?? "Active"
                : "No group report active."}
            </div>
          )}
        </div>
      </section>

      {/* Status */}
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Submissions · 提交状态
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {submittedCount}/{groups.length} submitted
          </span>
        </div>
        {!ev.group_report_template_id ? (
          <p className="text-[13px] text-[var(--ink-mute)]">Activate a template above to enable group reports.</p>
        ) : groups.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-mute)]">No groups generated for this event yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Group</th>
                  <th className="pb-3 font-normal">Leader</th>
                  <th className="pb-3 font-normal">Members</th>
                  <th className="pb-3 font-normal">Status</th>
                  <th className="pb-3 font-normal">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const st = statusByGroup.get(g.id);
                  const leader = g.members.find((m) => m.role === "zu_zhang") ?? g.members.find((m) => m.participant_id === g.leader_participant_id);
                  const leaderName = leader ? (leader.name_cn ?? leader.name_en ?? leader.region_id ?? "—") : "—";
                  const status = st?.status === "submitted" ? "Submitted" : st ? "Draft" : "Not started";
                  const tone = st?.status === "submitted" ? "bg-[#5b9a5d]/12 text-[#3a6b3b]" : st ? "bg-[var(--paper-deep)] text-[var(--ink-mute)]" : "bg-[var(--paper-deep)]/60 text-[var(--ink-faint)]";
                  return (
                    <tr key={g.id} className="border-t border-[var(--paper-shadow)]">
                      <td className="py-3 pr-4 text-[var(--ink)] tabular-nums">#{g.group_no}</td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)]">{leaderName}</td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">{g.members.length}</td>
                      <td className="py-3 pr-4">
                        <span className={`text-[10.5px] tracking-[0.12em] uppercase px-2 py-1 rounded-[var(--radius-pill)] ${tone}`}>{status}</span>
                      </td>
                      <td className="py-3 text-[var(--ink-mute)] tabular-nums text-[12px]">
                        {st?.submitted_at ? new Date(st.submitted_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
