import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { RecordingUploader } from "@/components/admin/recordings/RecordingUploader";
import { RecordingAccessCard, type RecordingView } from "@/components/admin/recordings/RecordingAccessCard";
import { loadEventMembers, loadGrants } from "@/lib/recordings/access";

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

  const service = createSupabaseServiceClient();
  const { data: recRows } = await service
    .from("event_recordings")
    .select("id, title_en, title_cn, mime_type, byte_size, duration_seconds, members_auto, created_at")
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  type Rec = {
    id: string; title_en: string | null; title_cn: string | null; mime_type: string | null;
    byte_size: number | null; duration_seconds: number | null; members_auto: boolean; created_at: string;
  };
  const recs = (recRows ?? []) as Rec[];
  const [members, grants] = await Promise.all([
    loadEventMembers(service, id),
    loadGrants(service, recs.map((r) => r.id)),
  ]);
  const recordings: RecordingView[] = recs.map((r) => ({
    id: r.id,
    title: r.title_cn ?? r.title_en ?? "—",
    mime_type: r.mime_type,
    size: formatBytes(r.byte_size),
    duration: formatDuration(r.duration_seconds),
    members_auto: r.members_auto,
    grants: (grants.get(r.id) ?? []).map((g) => ({
      grant_id: g.grant_id, id: g.id, name: g.name, region_id: g.region_id, until: g.until, note: g.note, expired: g.expired,
    })),
  }));
  const fmtDay = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

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
            Members with a valid programme who registered for this event
            watch the replays automatically until their programme ends. Add
            anyone else by hand · 配套有效会员自动观看，其他人手动添加。
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
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          Members · 会员
        </div>
        <h2 className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
          {members.length === 1 ? "1 member watches" : `${members.length} members watch`} automatically
        </h2>
        <p className="mt-1 text-[12.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[70ch]">
          Approved or paid registration for this event + a programme valid today. The list updates by itself as
          programmes start and end.
        </p>
        {members.length > 0 ? (
          <details className="mt-3 group">
            <summary className="cursor-pointer text-[12.5px] text-[var(--cinnabar-deep)] underline decoration-dotted underline-offset-4 w-fit">
              Show who
            </summary>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
              {members.map((m) => (
                <li key={m.id} className="text-[12.5px] text-[var(--ink)] truncate">
                  <Link href={`/admin/participants/${m.id}`} className="hover:text-[var(--cinnabar-deep)]">{m.name}</Link>
                  {m.region_id ? <span className="ml-1.5 font-mono text-[11px] text-[var(--ink-mute)]">{m.region_id}</span> : null}
                  <span className="ml-1.5 text-[11.5px] text-[var(--ink-mute)] tabular-nums">
                    {m.until ? `until ${fmtDay(m.until)}` : "no end"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="mt-8">
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
            {recordings.length} total
          </span>
        </div>
        {recordings.length === 0 ? (
          <p className="text-[13px] leading-[1.7] text-[var(--ink-mute)]">No recordings uploaded yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {recordings.map((r) => (
              <RecordingAccessCard key={r.id} eventId={ev.id} rec={r} memberCount={members.length} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
