import type { Metadata } from "next";
import Link from "next/link";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfCourses } from "@/lib/course-portal";
import type { CourseCard } from "@/lib/course-portal-types";

export const metadata: Metadata = { title: "Courses · 课程 — GMC" };
export const dynamic = "force-dynamic";

function statusTone(status: string): { label: string; cls: string } {
  switch (status) {
    case "paid":
      return { label: "Paid · 已付款", cls: "bg-[#5b9a5d]/12 text-[#3a6b3b]" };
    case "approved":
      return { label: "Approved · 已核准", cls: "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]" };
    case "pending_approval":
      return { label: "Pending · 待审核", cls: "bg-[var(--paper-deep)] text-[var(--ink-mute)]" };
    case "cancelled":
      return { label: "Cancelled · 已取消", cls: "bg-[var(--paper-deep)] text-[var(--ink-faint)]" };
    default:
      return { label: status, cls: "bg-[var(--paper-deep)] text-[var(--ink-mute)]" };
  }
}

function MetaChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] tracking-[0.1em] uppercase text-[var(--ink-mute)] px-2 py-1 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60">
      {label}
    </span>
  );
}

function Card({ course }: { course: CourseCard }) {
  const title = course.title_cn ?? course.title_en ?? course.slug;
  const alt = course.title_cn && course.title_en ? course.title_en : null;
  const tone = statusTone(course.enrollment_status);
  return (
    <Link
      href={`/me/courses/${course.event_id}`}
      className="group block rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] overflow-hidden shadow-[var(--shadow-paper-1)] hover:-translate-y-0.5 transition-transform duration-[var(--dur-fast)]"
      style={{ color: "inherit" }}
    >
      <div className="relative aspect-[16/7] bg-[var(--paper-deep)] overflow-hidden">
        {course.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.poster_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-display text-[22px] text-[var(--ink-faint)]">
            GMC
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <span
          className={`absolute top-3 left-3 text-[10px] tracking-[0.14em] uppercase px-2 py-1 rounded-[var(--radius-pill)] ${tone.cls}`}
        >
          {tone.label}
        </span>
      </div>
      <div className="p-5">
        <div className="font-display text-[18px] leading-[1.2] text-[var(--ink)] group-hover:text-[var(--cinnabar-deep)] transition-colors">
          {title}
        </div>
        {alt ? <div className="mt-0.5 text-[12.5px] italic text-[var(--ink-soft)]">{alt}</div> : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetaChip
            label={`${course.submitted_count}/${course.assignment_count} 作业`}
          />
          {course.recording_count > 0 ? (
            <MetaChip label={`${course.recording_count} 录像`} />
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export default async function MeCoursesPage() {
  const participant = await requireParticipant();
  const courses = await loadSelfCourses(participant.id);

  return (
    <div>
      <div>
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Courses · 课程
        </div>
        <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          My courses.
        </h1>
        <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
          Your enrolled courses. Open one to watch recordings and submit
          homework or reports. 打开课程可观看录像并提交作业或报告。
        </p>
      </div>

      <section className="mt-8">
        {courses.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-8 text-center text-[13.5px] text-[var(--ink-mute)]">
            You&apos;re not enrolled in any courses yet.
            <br />
            <span className="text-[12px] text-[var(--ink-faint)]">
              Courses appear here once you enroll. 报名后课程会显示在这里。
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {courses.map((c) => (
              <Card key={c.event_id} course={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
