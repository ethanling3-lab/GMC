import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { getCourseById } from "@/lib/courses/courses";
import { CourseForm } from "@/components/admin/courses/CourseForm";

export const metadata: Metadata = { title: "Edit course" };
export const dynamic = "force-dynamic";

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin");
  const { id } = await params;
  const course = await getCourseById(id);
  if (!course) notFound();
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase">
        <Link href="/admin/courses" className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Courses · 课程目录
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span className="text-[var(--ink-mute)]">{course.name_cn}</span>
      </div>
      <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        Edit course.
      </h1>
      <section className="mt-10">
        <CourseForm mode="edit" existing={course} />
      </section>
    </div>
  );
}
