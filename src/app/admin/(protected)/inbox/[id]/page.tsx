import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { loadConversationDetail } from "@/lib/inbox/inbox-query";
import {
  CONVERSATION_STATUS_LABEL,
  CONVERSATION_STATUS_TONE,
  channelLabel,
  participantDisplay,
  toneClasses,
  timestampFull,
} from "@/lib/inbox/format";
import { ChannelGlyph } from "@/components/admin/inbox/ChannelGlyph";
import { MessageBubble } from "@/components/admin/inbox/MessageBubble";
import { MessageComposer } from "@/components/admin/inbox/MessageComposer";
import { MarkReadOnMount } from "@/components/admin/inbox/MarkReadOnMount";
import { ScrollAnchor } from "@/components/admin/inbox/ScrollAnchor";
import { ParticipantCard } from "@/components/admin/inbox/ParticipantCard";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InboxThreadPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const detail = await loadConversationDetail(supabase, id);
  if (!detail) notFound();

  const { conversation, messages, enrollments } = detail;
  const p = conversation.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const statusLabel =
    CONVERSATION_STATUS_LABEL[conversation.status]?.en ?? conversation.status;
  const statusTone = CONVERSATION_STATUS_TONE[conversation.status] ?? "neutral";

  return (
    <div>
      <MarkReadOnMount conversationId={conversation.id} />
      {/* Breadcrumb */}
      <div className="mb-5">
        <Link
          href="/admin/inbox"
          className="inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to inbox
        </Link>
      </div>

      {/* Header card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Thread · 对话
            </div>
            <h1
              className={`mt-3 leading-[1.15] tracking-[-0.01em] text-[var(--ink)] truncate ${
                hasRealName
                  ? "font-display text-[26px]"
                  : "font-mono text-[18px] text-[var(--ink-soft)]"
              }`}
            >
              {displayName}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--ink-mute)]">
              <span className="inline-flex items-center gap-1.5 text-[var(--ink)]">
                <ChannelGlyph channel={conversation.channel} size={11} />
                {channelLabel(conversation.channel)}
              </span>
              {p?.region_id ? (
                <>
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span className="font-mono text-[var(--cinnabar-deep)]">{p.region_id}</span>
                </>
              ) : null}
              {p?.phone ? (
                <>
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span className="tabular-nums">{p.phone}</span>
                </>
              ) : null}
              {p?.email ? (
                <>
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span className="truncate max-w-[220px]">{p.email}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex items-stretch gap-3">
            <span
              className={`inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border text-[10.5px] tracking-[0.18em] uppercase ${toneClasses(statusTone)}`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Main layout: thread center + participant rail right.
          Thread locked to a viewport-relative height — the messages scroll
          inside, composer stays anchored. min/max clamp so the card reads
          the same on short laptops + tall 4K displays. */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <section
          className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden flex flex-col"
          style={{ height: "clamp(420px, calc(100dvh - 340px), 640px)" }}
        >
          <div
            id="inbox-thread-scroll"
            className="flex-1 min-h-0 overflow-y-auto px-5 py-6"
          >
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[13px] text-[var(--ink-mute)]">
                No messages in this thread yet.
              </div>
            ) : (
              <ol className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    showDaySeparator={shouldShowDaySeparator(
                      i > 0 ? messages[i - 1].created_at : null,
                      m.created_at,
                    )}
                  />
                ))}
                <ScrollAnchor dep={messages.length} />
              </ol>
            )}
          </div>

          <MessageComposer
            conversationId={conversation.id}
            channel={conversation.channel}
            disabled={conversation.status === "closed"}
            disabledReason={
              conversation.status === "closed"
                ? "Thread is closed — reopen before replying"
                : undefined
            }
          />
        </section>

        {/* Participant rail */}
        <aside className="flex flex-col gap-4">
          <ParticipantCard
            participant={p}
            enrollments={enrollments}
            conversationStatus={conversation.status}
            assignedAdmin={conversation.assigned_admin}
          />
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
            Opened {timestampFull(messages[0]?.created_at ?? conversation.last_message_at)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function shouldShowDaySeparator(prev: string | null, curr: string): boolean {
  if (!prev) return true;
  const a = new Date(prev);
  const b = new Date(curr);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}
