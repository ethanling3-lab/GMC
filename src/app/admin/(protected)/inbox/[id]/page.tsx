import type { Metadata } from "next";
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
} from "@/lib/inbox/format";
import { ChannelGlyph } from "@/components/admin/inbox/ChannelGlyph";
import { MessageBubble } from "@/components/admin/inbox/MessageBubble";
import { MessageComposer } from "@/components/admin/inbox/MessageComposer";
import { MarkReadOnMount } from "@/components/admin/inbox/MarkReadOnMount";
import { ScrollAnchor } from "@/components/admin/inbox/ScrollAnchor";
import { AiAssistantToggle } from "@/components/admin/inbox/AiAssistantToggle";
import { AiAssistPanel } from "@/components/admin/inbox/AiAssistPanel";
import { ThreadRightRail } from "@/components/admin/inbox/ThreadRightRail";
import { loadFlightInfoForParticipant } from "@/lib/inbox/flight-info-query";
import { loadSnippetContextForConversation } from "@/lib/inbox/snippets";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

// Thread view — full-height, edge-to-edge inside the inbox layout's children
// area. Three vertical bands:
//   [ thin header strip 56px ]
//   [ thread (scrolls) + composer (sticky bottom) | right rail (tabbed) ]
//
// No more boxed-in card framing; the inbox flow reads as one continuous
// surface. Right rail is a single tabbed panel (Profile / Travel) instead
// of two stacked cards.

export default async function InboxThreadPage({ params }: PageProps) {
  const admin = await requireAdmin();
  const { id } = await params;
  const canManageSnippets =
    admin.role === "super_admin" ||
    admin.role === "regional_lead" ||
    admin.role === "customer_service";

  const supabase = await createSupabaseServerClient();
  const detail = await loadConversationDetail(supabase, id);
  if (!detail) notFound();

  const { conversation, messages, enrollments } = detail;
  const flightRows = conversation.participant_id
    ? await loadFlightInfoForParticipant(supabase, conversation.participant_id)
    : [];
  const { context: snippetContext, preferredLanguage: snippetLanguage } =
    await loadSnippetContextForConversation(conversation.id);
  const p = conversation.participant;
  const displayName = participantDisplay(p);
  const hasRealName = Boolean((p?.name_en ?? p?.name_cn ?? "").trim());
  const statusLabel =
    CONVERSATION_STATUS_LABEL[conversation.status]?.en ?? conversation.status;
  const statusTone = CONVERSATION_STATUS_TONE[conversation.status] ?? "neutral";

  return (
    <div className="flex flex-col h-full min-h-0">
      <CrumbLabel segment={conversation.id} label={displayName} />
      <MarkReadOnMount conversationId={conversation.id} />

      {/* Thin header strip — identity left, actions right */}
      <header className="flex-none flex items-center justify-between gap-4 px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div
            className="flex-none w-9 h-9 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]
                       flex items-center justify-center text-[11px] tracking-[0.06em] font-medium
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
            aria-hidden="true"
          >
            {initialsFor(displayName)}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1
                className={
                  hasRealName
                    ? "font-display text-[16.5px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)] truncate max-w-[420px]"
                    : "font-mono text-[14px] leading-[1.2] text-[var(--ink-soft)] truncate max-w-[420px]"
                }
              >
                {displayName}
              </h1>
              {p?.region_id ? (
                <span className="font-mono text-[11.5px] text-[var(--cinnabar-deep)]">
                  {p.region_id}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10.5px] tracking-[0.04em] text-[var(--ink-mute)]">
              <span className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
                <ChannelGlyph channel={conversation.channel} size={10} />
                {channelLabel(conversation.channel)}
              </span>
              {p?.phone ? (
                <>
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span className="tabular-nums">{p.phone}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AiAssistPanel conversationId={conversation.id} />
          <AiAssistantToggle
            conversationId={conversation.id}
            initialEnabled={Boolean(conversation.ai_enabled)}
            channel={conversation.channel}
          />
          <span
            className={`inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border text-[10.5px] tracking-[0.18em] uppercase ${toneClasses(statusTone)}`}
          >
            {statusLabel}
          </span>
        </div>
      </header>

      {/* Body: thread + right rail */}
      <div className="flex-1 min-h-0 flex">
        <section className="flex-1 min-w-0 flex flex-col bg-[var(--paper)]">
          <div
            id="inbox-thread-scroll"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-6"
          >
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[13px] text-[var(--ink-mute)]">
                No messages in this thread yet.
              </div>
            ) : (
              <ol className="flex flex-col gap-3 max-w-[860px] mx-auto">
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
            participantName={
              (p?.name_en ?? p?.name_cn ?? "").trim() || undefined
            }
            defaultTemplateLanguage={
              p?.language_fluency === "cn" || p?.language_fluency === "both" ? "zh_CN" : "en_US"
            }
            snippetContext={snippetContext}
            snippetLanguage={snippetLanguage}
          />
        </section>

        <aside className="hidden lg:flex flex-none w-[300px] h-full border-l border-[var(--paper-shadow)]">
          <ThreadRightRail
            participant={p}
            enrollments={enrollments}
            conversationStatus={conversation.status}
            assignedAdmin={conversation.assigned_admin}
            conversationId={conversation.id}
            flightRows={flightRows}
            canManageSnippets={canManageSnippets}
          />
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

function initialsFor(src: string): string {
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "·";
}
