import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { SubmissionFileLink } from "@/components/admin/assignments/SubmissionFileLink";

export const metadata: Metadata = { title: "Submissions · 提交 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string; assignmentId: string }> };

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AssignmentSubmissionsPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "instructor"
  ) {
    redirect(`/admin/events`);
  }
  const { id, assignmentId } = await params;

  const service = createSupabaseServiceClient();
  const { data: assignment } = await service
    .from("course_assignments")
    .select("id, event_id, title_en, title_cn, kind, submission_type, due_at")
    .eq("id", assignmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!assignment) notFound();
  const a = assignment as {
    id: string;
    event_id: string;
    title_en: string | null;
    title_cn: string | null;
    kind: "homework" | "report";
    submission_type: "file" | "text" | "both";
    due_at: string | null;
  };
  const title = a.title_cn ?? a.title_en ?? "Assignment";

  const { data: subsRaw } = await service
    .from("course_submissions")
    .select(
      "id, status, text_body, submitted_at, updated_at, participant:participants(region_id, name_en, name_cn)",
    )
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false, nullsFirst: false });

  const subs = (subsRaw ?? []) as unknown as Array<{
    id: string;
    status: "draft" | "submitted";
    text_body: string | null;
    submitted_at: string | null;
    updated_at: string;
    participant: { region_id: string | null; name_en: string | null; name_cn: string | null } | null;
  }>;

  // Files per submission.
  const filesBySub = new Map<
    string,
    Array<{ id: string; filename: string; byte_size: number | null }>
  >();
  if (subs.length > 0) {
    const { data: files } = await service
      .from("course_submission_files")
      .select("id, submission_id, filename, byte_size")
      .in(
        "submission_id",
        subs.map((s) => s.id),
      )
      .order("created_at", { ascending: true });
    for (const f of (files ?? []) as Array<{
      id: string;
      submission_id: string;
      filename: string;
      byte_size: number | null;
    }>) {
      const arr = filesBySub.get(f.submission_id) ?? [];
      arr.push({ id: f.id, filename: f.filename, byte_size: f.byte_size });
      filesBySub.set(f.submission_id, arr);
    }
  }

  const submittedCount = subs.filter((s) => s.status === "submitted").length;

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)] flex-wrap">
        <Link href={`/admin/events/${id}/assignments`} className="hover:text-[var(--cinnabar-deep)]" style={{ color: "var(--cinnabar)" }}>
          Assignments · 作业
        </Link>
        <span className="text-[var(--ink-faint)]">›</span>
        <span>Submissions · 提交</span>
      </div>
      <h1 className="mt-4 font-display text-[30px] md:text-[34px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        {title}
      </h1>
      <p className="mt-3 text-[13.5px] text-[var(--ink-soft)]">
        {submittedCount} submitted · 已提交
        {a.due_at ? <span className="text-[var(--ink-mute)]"> · Due {fmtWhen(a.due_at)}</span> : null}
      </p>

      <section className="mt-8">
        {subs.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-8 text-center text-[13.5px] text-[var(--ink-mute)]">
            No submissions yet.
          </div>
        ) : (
          <ul className="space-y-4">
            {subs.map((s) => {
              const p = s.participant;
              const pname = p?.name_cn ?? p?.name_en ?? "Unknown";
              const files = filesBySub.get(s.id) ?? [];
              return (
                <li key={s.id} className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 shadow-[var(--shadow-paper-1)]">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-display text-[16px] text-[var(--ink)]">{pname}</div>
                      <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums mt-0.5">
                        {p?.region_id ?? "—"}
                      </div>
                    </div>
                    <div className="flex-none text-right">
                      {s.status === "submitted" ? (
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[#5b9a5d]/12 text-[#3a6b3b]">
                          ✓ Submitted
                        </span>
                      ) : (
                        <span className="text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                          Draft
                        </span>
                      )}
                      <div className="mt-1 text-[11px] text-[var(--ink-faint)] tabular-nums">
                        {fmtWhen(s.submitted_at ?? s.updated_at)}
                      </div>
                    </div>
                  </div>

                  {s.text_body ? (
                    <div className="mt-3 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] whitespace-pre-wrap max-w-[74ch] border-l-2 border-[var(--paper-shadow)] pl-4">
                      {s.text_body}
                    </div>
                  ) : null}

                  {files.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {files.map((f) => (
                        <SubmissionFileLink key={f.id} fileId={f.id} filename={f.filename} bytes={f.byte_size} />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
