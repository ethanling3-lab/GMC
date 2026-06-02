import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParticipant } from "@/lib/participant-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";
import { VideoPlayer } from "@/components/portal/VideoPlayer";

export const metadata: Metadata = { title: "Watch · 观看 — GMC" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 600;

export default async function MeRecordingPlaybackPage({ params }: PageProps) {
  const participant = await requireParticipant();
  const { id: recordingId } = await params;

  const service = createSupabaseServiceClient();
  // Gate: must have a live grant. 404 (not 403) on missing access.
  const { data: access } = await service
    .from("event_recording_access")
    .select("id")
    .eq("recording_id", recordingId)
    .eq("participant_id", participant.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!access) notFound();

  const { data: recordingRaw } = await service
    .from("event_recordings")
    .select(
      "id, event_id, title_en, title_cn, description_en, description_cn, storage_path, mime_type, duration_seconds, deleted_at, event:events(title_en, title_cn)",
    )
    .eq("id", recordingId)
    .maybeSingle();
  const recording = recordingRaw as unknown as
    | {
        id: string;
        event_id: string;
        title_en: string | null;
        title_cn: string | null;
        description_en: string | null;
        description_cn: string | null;
        storage_path: string;
        mime_type: string | null;
        duration_seconds: number | null;
        deleted_at: string | null;
        event: { title_en: string | null; title_cn: string | null } | null;
      }
    | null;
  if (!recording || recording.deleted_at) notFound();

  const { data: signed } = await service.storage
    .from("event-recordings")
    .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS);
  if (!signed) notFound();

  // Audit: log a 'recording.played' event for the first signed-URL mint
  // per page visit. Subsequent client-side refreshes don't re-log to keep
  // audit volume manageable.
  await writeAuditLog({
    actor_id: null,
    action: "recording.played",
    entity: "event_recordings",
    entity_id: recording.id,
    metadata: { participant_id: participant.id },
  });

  const title = recording.title_cn ?? recording.title_en ?? "Recording";
  const altTitle =
    recording.title_en && recording.title_cn
      ? recording.title_en
      : recording.title_cn && !recording.title_en
        ? null
        : recording.title_cn ?? null;
  const eventTitle = recording.event?.title_cn ?? recording.event?.title_en ?? null;

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <Link
          href="/me/recordings"
          className="hover:text-[var(--cinnabar-deep)]"
          style={{ color: "var(--cinnabar)" }}
        >
          ← Recordings · 录像
        </Link>
      </div>
      <h1 className="mt-4 font-display text-[26px] md:text-[30px] leading-[1.15] tracking-[-0.015em] text-[var(--ink)]">
        {title}
      </h1>
      {altTitle ? (
        <div className="mt-1 text-[14px] italic text-[var(--ink-soft)]">{altTitle}</div>
      ) : null}
      {eventTitle ? (
        <div className="mt-1 text-[12px] tracking-[0.06em] text-[var(--ink-mute)]">
          {eventTitle}
        </div>
      ) : null}

      <div className="mt-6 rounded-[var(--radius-lg)] overflow-hidden border border-[var(--paper-shadow)] bg-black">
        <VideoPlayer
          recordingId={recording.id}
          initialSignedUrl={signed.signedUrl}
          mimeType={recording.mime_type ?? "video/mp4"}
        />
      </div>

      {recording.description_cn || recording.description_en ? (
        <div className="mt-6 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] whitespace-pre-wrap max-w-[68ch]">
          {recording.description_cn ?? recording.description_en}
        </div>
      ) : null}
    </div>
  );
}
