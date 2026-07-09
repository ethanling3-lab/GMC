import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParticipant } from "@/lib/participant-guard";
import { loadGroupReportForFill } from "@/lib/group-report-portal";
import { GroupReportForm } from "@/components/portal/GroupReportForm";

export const metadata: Metadata = { title: "Group report · 小组报告 — GMC" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ groupId: string }> };

export default async function MeGroupReportPage({ params }: PageProps) {
  const participant = await requireParticipant();
  const { groupId } = await params;

  const fill = await loadGroupReportForFill(participant.id, groupId);
  if (!fill) notFound();

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link
          href={`/me/courses/${fill.group.event_id}`}
          className="hover:text-[var(--cinnabar-deep)]"
          style={{ color: "var(--cinnabar)" }}
        >
          ← {fill.event.title_cn ?? fill.event.title_en ?? "Course"} · 课程
        </Link>
      </div>
      <GroupReportForm fill={fill} />
    </div>
  );
}
