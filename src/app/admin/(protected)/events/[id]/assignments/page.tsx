import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { AssignmentManager, type AdminAssignmentRow } from "@/components/admin/assignments/AssignmentManager";

export const metadata: Metadata = { title: "Assignments · 作业 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EventAssignmentsPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect(`/admin/events`);
  }
  const { id } = await params;

  const service = createSupabaseServiceClient();
  const { data: event } = await service
    .from("events")
    .select("id, slug, title_en, title_cn")
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();
  const ev = event as { id: string; slug: string; title_en: string | null; title_cn: string | null };
  const title = ev.title_cn ?? ev.title_en ?? ev.slug;

  const { data: assignments } = await service
    .from("course_assignments")
    .select("id, title_en, title_cn, kind, submission_type, due_at, active, created_at")
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const rows = (assignments ?? []) as Array<{
    id: string;
    title_en: string | null;
    title_cn: string | null;
    kind: "homework" | "report";
    submission_type: "file" | "text" | "both";
    due_at: string | null;
    active: boolean;
    created_at: string;
  }>;

  // Submission counts.
  const submitted = new Map<string, number>();
  const draft = new Map<string, number>();
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: subs } = await service
      .from("course_submissions")
      .select("assignment_id, status")
      .in("assignment_id", ids);
    for (const s of (subs ?? []) as Array<{ assignment_id: string; status: string }>) {
      const map = s.status === "submitted" ? submitted : draft;
      map.set(s.assignment_id, (map.get(s.assignment_id) ?? 0) + 1);
    }
  }

  const initial: AdminAssignmentRow[] = rows.map((r) => ({
    ...r,
    submitted_count: submitted.get(r.id) ?? 0,
    draft_count: draft.get(r.id) ?? 0,
  }));

  return (
    <div>
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <Link href={`/admin/events/${id}`} className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
            {title}
          </Link>
          <span className="text-[var(--ink-faint)]">›</span>
          <span>Assignments · 作业</span>
        </div>
        <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Homework &amp; reports.
        </h1>
        <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
          Create assignments for this course. Learners submit text and/or files
          from their portal; you review submissions here.
        </p>
      </div>

      <AssignmentManager eventId={ev.id} initial={initial} />
    </div>
  );
}
