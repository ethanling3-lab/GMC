import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { RecordingUploader } from "@/components/admin/recordings/RecordingUploader";
import { BulkPaidGrantButton } from "@/components/admin/recordings/BulkPaidGrantButton";

export const metadata: Metadata = { title: "Recordings · 录像 — Admin" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

function formatBytes(b: number | null): string {
  if (!b) return "—";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function EventRecordingsPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect(`/admin/events`);
  }
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, slug, title_en, title_cn")
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  const { data: recordings } = await supabase
    .from("event_recordings")
    .select(
      "id, title_en, title_cn, mime_type, byte_size, duration_seconds, created_at",
    )
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Grant counts per recording.
  const rIds = (recordings ?? []).map((r) => (r as { id: string }).id);
  const grantCounts = new Map<string, number>();
  if (rIds.length > 0) {
    const { data: grants } = await supabase
      .from("event_recording_access")
      .select("recording_id")
      .in("recording_id", rIds)
      .is("revoked_at", null);
    for (const g of (grants ?? []) as Array<{ recording_id: string }>) {
      grantCounts.set(g.recording_id, (grantCounts.get(g.recording_id) ?? 0) + 1);
    }
  }

  const ev = event as { id: string; slug: string; title_en: string | null; title_cn: string | null };
  const title = ev.title_cn ?? ev.title_en ?? ev.slug;

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <Link
              href={`/admin/events/${id}`}
              className="hover:text-[var(--cinnabar-deep)]"
              style={{ color: "var(--cinnabar)" }}
            >
              {title}
            </Link>
            <span className="text-[var(--ink-faint)]">›</span>
            <span>Recordings · 录像</span>
          </div>
          <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
            Class recordings.
          </h1>
          <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
            Upload videos or audio. Grant access per participant (or to
            everyone who paid) and they&apos;ll see it in their portal.
          </p>
        </div>
      </div>

      <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              Upload · 上传
            </div>
            <h2 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
              Add a new recording
            </h2>
          </div>
        </div>
        <RecordingUploader eventId={ev.id} />
      </section>

      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-4 h-px bg-current" />
              Library · 录像库
            </div>
            <h2 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
              Recordings for this event
            </h2>
          </div>
          <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {(recordings ?? []).length} total
          </span>
        </div>
        {(recordings ?? []).length === 0 ? (
          <p className="text-[13px] leading-[1.7] text-[var(--ink-mute)]">
            No recordings uploaded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  <th className="pb-3 font-normal">Title</th>
                  <th className="pb-3 font-normal">Duration</th>
                  <th className="pb-3 font-normal">Size</th>
                  <th className="pb-3 font-normal">Grants</th>
                  <th className="pb-3 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(recordings ?? []).map((r) => {
                  const row = r as {
                    id: string;
                    title_en: string | null;
                    title_cn: string | null;
                    mime_type: string | null;
                    byte_size: number | null;
                    duration_seconds: number | null;
                    created_at: string;
                  };
                  const t = row.title_cn ?? row.title_en ?? "—";
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/50 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div className="text-[var(--ink)] truncate max-w-[320px]">{t}</div>
                        <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] mt-0.5">
                          {row.mime_type ?? "—"}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">
                        {formatDuration(row.duration_seconds)}
                      </td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">
                        {formatBytes(row.byte_size)}
                      </td>
                      <td className="py-3 pr-4 text-[var(--ink-soft)] tabular-nums">
                        {grantCounts.get(row.id) ?? 0}
                      </td>
                      <td className="py-3 text-right">
                        <BulkPaidGrantButton eventId={ev.id} recordingId={row.id} />
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
