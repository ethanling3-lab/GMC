import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParticipant } from "@/lib/participant-guard";
import { loadCourseDetail } from "@/lib/course-portal";
import { loadLeaderGroupReports } from "@/lib/group-report-portal";
import { CourseDetail } from "@/components/portal/CourseDetail";

export const metadata: Metadata = { title: "Course · 课程 — GMC" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function MeCoursePage({ params }: PageProps) {
  const participant = await requireParticipant();
  const { id } = await params;

  const detail = await loadCourseDetail(participant.id, id);
  if (!detail) notFound();

  // Group reports this participant leads for THIS event (a group belongs to a
  // course, so the entry point lives inside the course, not a global nav item).
  const groupReports = (await loadLeaderGroupReports(participant.id)).filter(
    (r) => r.event_id === id,
  );

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link
          href="/me/courses"
          className="hover:text-[var(--cinnabar-deep)]"
          style={{ color: "var(--cinnabar)" }}
        >
          ← Courses · 课程
        </Link>
      </div>
      <CourseDetail detail={detail} groupReports={groupReports} />
    </div>
  );
}
