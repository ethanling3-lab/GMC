"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { channelLabel } from "@/lib/inbox/format";
import { ChannelGlyph } from "./ChannelGlyph";
import {
  renderTemplateBody,
  type TemplateLanguage,
  type TemplateSummary,
} from "@/lib/inbox/whatsapp-templates-types";

// Reply composer. Three modes:
//   - text: default free-form textarea with optional attachments (WhatsApp)
//   - template: WhatsApp-only HSM template picker. Opens via the Templates
//     button; auto-opens when a text send returns error_code=outside_window.
//   - media: not a mode per se — attachments live alongside text and flip
//     the send into the media path when present on submit.
//
// UX:
//   - Enter to send in text mode, Shift+Enter for newline
//   - Optimistic: clear textarea immediately, router.refresh() pulls the real
//     row from the server
//   - On send failure, text + attachment chips are restored + error banner
//   - Outside-24h banner hands the admin directly into the template flow
//   - Attachments: paperclip → file picker → parallel upload → chips. Send
//     is disabled while any chip is still uploading.

const ACCEPT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/webm",
] as const;

const ACCEPT_ATTR = ACCEPT_MIME.join(",");
const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 10 * 1024 * 1024;

type PendingAttachment = {
  clientId: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
  path?: string;
  size: number;
  mime_type: string;
  filename: string;
  abort: AbortController;
};

type MediaSummary = { sent: number; failed: number; total: number };

export function MessageComposer({
  conversationId,
  channel,
  disabled = false,
  disabledReason,
  participantName,
  defaultTemplateLanguage,
}: {
  conversationId: string;
  channel: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Prefills the `name` param on templates when available. */
  participantName?: string;
  /** Defaults the template language toggle; admin can still swap. */
  defaultTemplateLanguage?: TemplateLanguage;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<"outside_window" | "provider" | null>(null);
  const [mediaSummary, setMediaSummary] = useState<MediaSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  const canUseTemplates = channel === "whatsapp";
  const canAttach = channel === "whatsapp";
  const [mode, setMode] = useState<"text" | "template">("text");

  // Auto-grow the textarea. Cap the growth so the thread above stays visible.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || mode !== "text") return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, mode]);

  // Abort any in-flight uploads on unmount.
  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.status === "uploading") a.abort.abort();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUploading = attachments.some((a) => a.status === "uploading");
  const readyAttachments = useMemo(
    () => attachments.filter((a) => a.status === "ready"),
    [attachments],
  );

  const uploadFile = useCallback(
    async (item: PendingAttachment) => {
      const form = new FormData();
      form.append("conversation_id", conversationId);
      // Re-attach the File object — pulling it from input.files since we don't
      // want to store the File on state (breaks structured-clone in some envs).
      // The upload queue is called right after setState, so we pass it through
      // closure via the caller.
      return form;
    },
    [conversationId],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (!canAttach || disabled) return;
      setError(null);
      setMediaSummary(null);

      const picked = Array.from(files);
      const slotsLeft = MAX_ATTACHMENTS - attachments.length;
      if (picked.length > slotsLeft) {
        setError(`Can only attach ${MAX_ATTACHMENTS} files per send.`);
      }

      const accepted = picked.slice(0, Math.max(0, slotsLeft));
      const newPending: Array<{ pending: PendingAttachment; file: File }> = [];

      for (const file of accepted) {
        const mime = file.type || "application/octet-stream";
        if (!ACCEPT_MIME.includes(mime as (typeof ACCEPT_MIME)[number])) {
          setError(`${file.name}: unsupported file type (${mime}).`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name}: file larger than 10 MB.`);
          continue;
        }
        const abort = new AbortController();
        const pending: PendingAttachment = {
          clientId: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
          status: "uploading",
          size: file.size,
          mime_type: mime,
          filename: file.name,
          abort,
        };
        newPending.push({ pending, file });
      }

      if (newPending.length === 0) return;

      setAttachments((prev) => [...prev, ...newPending.map((p) => p.pending)]);

      // Fire uploads in parallel.
      for (const { pending, file } of newPending) {
        const form = new FormData();
        form.append("conversation_id", conversationId);
        form.append("file", file);

        fetch(`/api/admin/inbox/attachments/upload`, {
          method: "POST",
          body: form,
          signal: pending.abort.signal,
        })
          .then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            if (!res.ok) {
              const detail = typeof body.detail === "string"
                ? (body.detail as string)
                : typeof body.error === "string"
                  ? (body.error as string)
                  : `Upload failed (${res.status})`;
              setAttachments((prev) =>
                prev.map((a) =>
                  a.clientId === pending.clientId
                    ? { ...a, status: "failed", error: detail }
                    : a,
                ),
              );
              return;
            }
            const path = typeof body.path === "string" ? (body.path as string) : undefined;
            setAttachments((prev) =>
              prev.map((a) =>
                a.clientId === pending.clientId
                  ? { ...a, status: "ready", path }
                  : a,
              ),
            );
          })
          .catch((err: unknown) => {
            if ((err as { name?: string })?.name === "AbortError") return;
            const msg = err instanceof Error ? err.message : "Network error";
            setAttachments((prev) =>
              prev.map((a) =>
                a.clientId === pending.clientId
                  ? { ...a, status: "failed", error: msg }
                  : a,
              ),
            );
          });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachments.length, canAttach, conversationId, disabled],
  );

  const removeAttachment = useCallback((clientId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.clientId === clientId);
      if (target?.status === "uploading") target.abort.abort();
      return prev.filter((a) => a.clientId !== clientId);
    });
  }, []);

  const onOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
      // Reset so the same file can be re-picked later.
      e.target.value = "";
    },
    [handleFiles],
  );

  const send = useCallback(async () => {
    const body = value.trim();
    const hasReadyAtt = readyAttachments.length > 0;
    const wouldSend = body.length > 0 || hasReadyAtt;
    if (!wouldSend || sending || disabled || hasUploading) return;

    const valueSnapshot = value;
    const attSnapshot = attachments;
    setSending(true);
    setError(null);
    setErrorCode(null);
    setMediaSummary(null);
    setValue("");
    setAttachments([]);

    try {
      const payload: Record<string, unknown> = {};
      if (hasReadyAtt) {
        payload.attachments = readyAttachments.map((a) => ({
          path: a.path,
          mime_type: a.mime_type,
          filename: a.filename,
          size: a.size,
        }));
        if (body) payload.body_text = body;
      } else {
        payload.body_text = body;
      }

      const res = await fetch(`/api/admin/inbox/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        const detail = typeof data.detail === "string"
          ? (data.detail as string)
          : typeof data.error === "string"
            ? (data.error as string)
            : `Send failed (${res.status})`;
        setError(detail);
        setValue(valueSnapshot);
        setAttachments(attSnapshot);
        return;
      }

      // Media response has {kind: 'media', total, sent, failed, results}.
      if (data.kind === "media") {
        const total = Number(data.total ?? 0);
        const sent = Number(data.sent ?? 0);
        const failed = Number(data.failed ?? 0);
        if (failed > 0 && sent === 0) {
          const first = Array.isArray(data.results)
            ? ((data.results as Array<{ error?: string }>)[0]?.error ?? null)
            : null;
          setError(first ?? "All attachments failed to send.");
        } else if (failed > 0) {
          setMediaSummary({ sent, failed, total });
        }
      } else {
        const softError = typeof data.error === "string" ? (data.error as string) : null;
        const code = typeof data.error_code === "string" ? (data.error_code as string) : null;
        if (softError) {
          setError(softError);
          if (code === "outside_window") {
            setErrorCode("outside_window");
            setValue(valueSnapshot);
            if (canUseTemplates) setMode("template");
          } else if (code === "provider") {
            setErrorCode("provider");
          }
        }
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setValue(valueSnapshot);
      setAttachments(attSnapshot);
    } finally {
      setSending(false);
    }
  }, [
    attachments,
    canUseTemplates,
    conversationId,
    disabled,
    hasUploading,
    readyAttachments,
    router,
    sending,
    value,
  ]);

  const busy = sending || isPending;

  if (disabled) {
    return (
      <div className="border-t border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-5 py-4 text-[11.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)] flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" />
          <path d="M4 6h4M6 4v4" />
        </svg>
        {disabledReason ?? "Replying is disabled for this thread"}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-5 py-4">
      {mode === "template" && canUseTemplates ? (
        <TemplatePanel
          conversationId={conversationId}
          channel={channel}
          participantName={participantName}
          defaultLanguage={defaultTemplateLanguage ?? "en_US"}
          outOfWindow={errorCode === "outside_window"}
          onCancel={() => {
            setMode("text");
            setErrorCode(null);
            setError(null);
          }}
          onSent={(softError) => {
            setError(softError);
            setErrorCode(softError ? "provider" : null);
            setMode("text");
            setValue("");
            startTransition(() => router.refresh());
          }}
        />
      ) : (
        <TextPanel
          channel={channel}
          value={value}
          setValue={setValue}
          busy={busy}
          onSend={send}
          textareaRef={textareaRef}
          canUseTemplates={canUseTemplates}
          onOpenTemplates={() => {
            setMode("template");
            setError(null);
            setErrorCode(null);
          }}
          canAttach={canAttach}
          onOpenFilePicker={onOpenFilePicker}
          attachments={attachments}
          removeAttachment={removeAttachment}
          hasUploading={hasUploading}
          readyCount={readyAttachments.length}
          errorBanner={
            error ? (
              <ErrorBanner
                text={error}
                code={errorCode}
                onTemplates={
                  canUseTemplates && errorCode === "outside_window"
                    ? () => {
                        setMode("template");
                      }
                    : undefined
                }
              />
            ) : mediaSummary ? (
              <PartialMediaBanner summary={mediaSummary} />
            ) : null
          }
        />
      )}
      {/* Hidden file input — always mounted so the ref is available even
          while the template panel is visible (not needed today but cheap). */}
      {canAttach ? (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={onFileInputChange}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Text mode panel
// -----------------------------------------------------------------------------

function TextPanel({
  channel,
  value,
  setValue,
  busy,
  onSend,
  textareaRef,
  canUseTemplates,
  onOpenTemplates,
  canAttach,
  onOpenFilePicker,
  attachments,
  removeAttachment,
  hasUploading,
  readyCount,
  errorBanner,
}: {
  channel: string;
  value: string;
  setValue: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  canUseTemplates: boolean;
  onOpenTemplates: () => void;
  canAttach: boolean;
  onOpenFilePicker: () => void;
  attachments: PendingAttachment[];
  removeAttachment: (id: string) => void;
  hasUploading: boolean;
  readyCount: number;
  errorBanner: React.ReactNode;
}) {
  const canSend = !busy && !hasUploading && (value.trim().length > 0 || readyCount > 0);
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex-none mt-2 w-8 h-8 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] flex items-center justify-center text-[var(--cinnabar)]"
        title={channelLabel(channel)}
        aria-hidden="true"
      >
        <ChannelGlyph channel={channel} size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <label className="sr-only" htmlFor="inbox-composer">
          Reply
        </label>
        <textarea
          id="inbox-composer"
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            attachments.length > 0
              ? "Caption (optional — sent on the first attachment)"
              : `Reply via ${channelLabel(channel)}… (Shift+Enter for newline)`
          }
          rows={2}
          disabled={busy}
          className="block w-full resize-none bg-[var(--paper)] border border-[var(--paper-shadow)]
                     rounded-[var(--radius-md)] px-3.5 py-2.5
                     text-[13.5px] leading-[1.55] text-[var(--ink)]
                     placeholder:text-[var(--ink-faint)]
                     focus:outline-none focus:border-[var(--cinnabar)]/40
                     focus:shadow-[var(--shadow-focus)]
                     transition-[border-color,box-shadow] duration-[var(--dur-fast)]
                     disabled:opacity-60"
        />

        {attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <li key={a.clientId}>
                <AttachmentChip
                  attachment={a}
                  onRemove={() => removeAttachment(a.clientId)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {errorBanner}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {canAttach ? (
              <button
                type="button"
                onClick={onOpenFilePicker}
                disabled={busy}
                title="Attach files (images, PDF, audio)"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]
                           text-[11px] tracking-[0.1em] uppercase
                           hover:border-[var(--cinnabar)]/30 hover:text-[var(--ink)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[border-color,color] duration-[var(--dur-fast)]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8.5 5.5l-4 4a1.8 1.8 0 0 1-2.5-2.5l5-5a3 3 0 0 1 4.2 4.2l-5 5" />
                </svg>
                Attach
              </button>
            ) : null}
            {canUseTemplates ? (
              <button
                type="button"
                onClick={onOpenTemplates}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                           border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]
                           text-[11px] tracking-[0.1em] uppercase
                           hover:border-[var(--cinnabar)]/30 hover:text-[var(--ink)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-[border-color,color] duration-[var(--dur-fast)]"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1.5" y="2" width="8" height="7" rx="1" />
                  <path d="M3 4.5h5M3 6.5h3" />
                </svg>
                Templates
              </button>
            ) : null}
            {!canAttach && !canUseTemplates ? (
              <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                AI drafts ship later
              </span>
            ) : null}
            {hasUploading ? (
              <span className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                Uploading…
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                       border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                       text-[12px] tracking-[0.04em] font-medium
                       hover:bg-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-[background-color,opacity] duration-[var(--dur-fast)]"
          >
            {busy ? "Sending…" : "Send"}
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 5.5h7M6 2l3 3.5-3 3.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Attachment chip
// -----------------------------------------------------------------------------

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const sizeKb = Math.max(1, Math.round(attachment.size / 1024));
  const sizeLabel = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  const isFailed = attachment.status === "failed";
  const isUploading = attachment.status === "uploading";

  const iconColor = isFailed
    ? "text-[var(--cinnabar-deep)]"
    : isUploading
      ? "text-[var(--ink-faint)]"
      : "text-[var(--cinnabar)]";

  return (
    <div
      className={`inline-flex items-center gap-2 max-w-[260px] pl-2.5 pr-1.5 h-8 rounded-[var(--radius-pill)]
                  border text-[11.5px]
                  ${
                    isFailed
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]"
                  }`}
      title={attachment.error ?? `${attachment.filename} · ${sizeLabel}`}
    >
      <span className={`flex-none ${iconColor}`} aria-hidden="true">
        {isUploading ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="animate-spin">
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.4" />
            <path d="M9.5 5.5A4 4 0 0 0 5.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : isFailed ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5.5" cy="5.5" r="4.2" />
            <path d="M3.5 3.5l4 4M7.5 3.5l-4 4" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1.5h4l2.5 2.5v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
            <path d="M6.5 1.5v2.5H9" />
          </svg>
        )}
      </span>
      <span className="truncate">{attachment.filename}</span>
      <span className="flex-none text-[var(--ink-faint)] tabular-nums">{sizeLabel}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.filename}`}
        className="flex-none ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full
                   text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]
                   transition-colors duration-[var(--dur-fast)]"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l5 5M7 2l-5 5" />
        </svg>
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Partial-failure banner (some attachments sent, some didn't).
// -----------------------------------------------------------------------------

function PartialMediaBanner({ summary }: { summary: MediaSummary }) {
  return (
    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] px-3 py-2 text-[12px] text-[var(--ink)]">
      Sent {summary.sent} of {summary.total}.{" "}
      {summary.failed > 0
        ? `${summary.failed} failed — check the thread for the red dot and retry if needed.`
        : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Template mode panel — list → params → preview → send
// -----------------------------------------------------------------------------

function TemplatePanel({
  conversationId,
  channel,
  participantName,
  defaultLanguage,
  outOfWindow,
  onCancel,
  onSent,
}: {
  conversationId: string;
  channel: string;
  participantName?: string;
  defaultLanguage: TemplateLanguage;
  outOfWindow: boolean;
  onCancel: () => void;
  onSent: (softError: string | null) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [language, setLanguage] = useState<TemplateLanguage>(defaultLanguage);
  const [params, setParams] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadTemplates = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      const url = refresh
        ? "/api/admin/inbox/templates?refresh=1"
        : "/api/admin/inbox/templates";
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        templates?: TemplateSummary[];
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setLoadErr(body.detail ?? body.error ?? `Load failed (${res.status})`);
        return;
      }
      setLoadErr(null);
      setTemplates(body.templates ?? []);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : "Network error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadTemplates();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTemplates]);

  useEffect(() => {
    if (!selected) return;
    if (!selected.languages.includes(language)) {
      setLanguage(selected.languages[0]);
    }
  }, [selected, language]);

  // Prefill the "Participant name" slot when available. Our six known
  // templates map variable_1 → participant name via the override labels;
  // detect by inspecting the label rather than hardcoding template names.
  useEffect(() => {
    if (!selected || !participantName) return;
    const nameSlot = selected.params.find((p) =>
      p.label_en.toLowerCase().includes("participant name"),
    );
    if (!nameSlot) return;
    setParams((prev) => {
      if ((prev[nameSlot.key] ?? "").trim()) return prev;
      return { ...prev, [nameSlot.key]: participantName };
    });
  }, [selected, participantName]);

  const preview = useMemo(() => {
    if (!selected) return "";
    return renderTemplateBody(selected.body_by_language[language], params);
  }, [selected, language, params]);

  async function handleSend() {
    if (!selected || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await fetch(`/api/admin/inbox/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template: {
            name: selected.name,
            language_code: language,
            params,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail = typeof body.detail === "string"
          ? (body.detail as string)
          : typeof body.error === "string"
            ? (body.error as string)
            : `Send failed (${res.status})`;
        setSendErr(detail);
        return;
      }
      const softError = typeof body.error === "string" ? (body.error as string) : null;
      onSent(softError);
    } catch (err) {
      setSendErr(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  }

  const missingRequiredParam = selected
    ? selected.params.some((p) => !(params[p.key] ?? "").trim())
    : true;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="flex-none mt-0.5 w-8 h-8 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] flex items-center justify-center text-[var(--cinnabar)]"
            title={channelLabel(channel)}
            aria-hidden="true"
          >
            <ChannelGlyph channel={channel} size={12} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--cinnabar)]">
              Template · 模板
            </div>
            <div className="mt-1 text-[12.5px] text-[var(--ink-soft)] leading-[1.5]">
              {outOfWindow
                ? "Outside the 24-hour window — pick an approved template."
                : "Send a pre-approved WhatsApp template."}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)]
                     border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]
                     text-[11px] tracking-[0.1em] uppercase
                     hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30
                     focus-visible:shadow-[var(--shadow-focus)]
                     transition-[border-color,color] duration-[var(--dur-fast)]"
        >
          Cancel
        </button>
      </div>

      {loadErr ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)] flex items-start justify-between gap-3">
          <span className="min-w-0 break-words">{loadErr}</span>
          <button
            type="button"
            onClick={() => loadTemplates(true)}
            disabled={refreshing}
            className="flex-none text-[10.5px] tracking-[0.14em] uppercase underline underline-offset-2 hover:no-underline disabled:opacity-40"
          >
            {refreshing ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : !templates ? (
        <div className="text-[12px] text-[var(--ink-faint)] tracking-[0.08em] uppercase py-2">
          Loading templates…
        </div>
      ) : selected ? (
        <TemplateForm
          template={selected}
          language={language}
          setLanguage={setLanguage}
          params={params}
          setParams={setParams}
          preview={preview}
          sending={sending}
          sendErr={sendErr}
          canSend={!missingRequiredParam}
          onBack={() => {
            setSelected(null);
            setSendErr(null);
          }}
          onSend={handleSend}
        />
      ) : (
        <TemplateList
          templates={templates}
          onSelect={(t) => {
            setSelected(t);
            setLanguage(
              t.languages.includes(defaultLanguage) ? defaultLanguage : t.languages[0],
            );
          }}
          onRefresh={() => loadTemplates(true)}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}

function TemplateList({
  templates,
  onSelect,
  onRefresh,
  refreshing,
}: {
  templates: TemplateSummary[];
  onSelect: (t: TemplateSummary) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (templates.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-5 text-[12.5px] text-[var(--ink-mute)] flex items-start justify-between gap-3">
        <span>
          No approved templates found. Submit + approve templates in Meta Business Manager, then hit Refresh.
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex-none text-[10.5px] tracking-[0.14em] uppercase underline underline-offset-2 hover:no-underline disabled:opacity-40"
        >
          {refreshing ? "Syncing…" : "Refresh"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          {templates.length} approved · synced from Meta
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] disabled:opacity-40 transition-colors duration-[var(--dur-fast)]"
        >
          {refreshing ? "Syncing…" : "Refresh"}
        </button>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
      {templates.map((t) => (
        <li key={t.name}>
          <button
            type="button"
            onClick={() => onSelect(t)}
            className="group w-full text-left rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                       bg-[var(--paper)] px-3.5 py-3
                       hover:border-[var(--cinnabar)]/30 hover:shadow-[var(--shadow-paper-1)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--cinnabar)]/80">
                {t.category}
              </span>
              <span className="text-[10px] text-[var(--ink-faint)] tracking-[0.08em]">
                {t.languages.join(" · ")}
              </span>
            </div>
            <div className="mt-1 text-[13px] text-[var(--ink)] font-display tracking-[-0.005em]">
              {t.label_en}
            </div>
            <div className="mt-0.5 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
              {t.description_en}
            </div>
          </button>
        </li>
      ))}
      </ul>
    </div>
  );
}

function TemplateForm({
  template,
  language,
  setLanguage,
  params,
  setParams,
  preview,
  sending,
  sendErr,
  canSend,
  onBack,
  onSend,
}: {
  template: TemplateSummary;
  language: TemplateLanguage;
  setLanguage: (l: TemplateLanguage) => void;
  params: Record<string, string>;
  setParams: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  preview: string;
  sending: boolean;
  sendErr: string | null;
  canSend: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[11px] tracking-[0.1em] uppercase
                       text-[var(--ink-mute)] hover:text-[var(--ink)]
                       transition-colors duration-[var(--dur-fast)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2L3 5l3 3" />
            </svg>
            All templates
          </button>
          <span className="text-[var(--ink-faint)] text-[11px]">·</span>
          <span className="text-[12px] text-[var(--ink-soft)] font-mono">{template.name}</span>
        </div>
        <LanguageToggle
          value={language}
          onChange={setLanguage}
          available={template.languages}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {template.params.map((spec) => (
          <label key={spec.key} className="block">
            <span className="block text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-mute)] mb-1">
              {language === "zh_CN" ? spec.label_cn : spec.label_en}
            </span>
            {spec.multiline ? (
              <textarea
                rows={2}
                value={params[spec.key] ?? ""}
                onChange={(e) =>
                  setParams((prev) => ({ ...prev, [spec.key]: e.target.value }))
                }
                placeholder={
                  language === "zh_CN" ? spec.placeholder_cn : spec.placeholder_en
                }
                className="block w-full resize-none bg-[var(--paper)] border border-[var(--paper-shadow)]
                           rounded-[var(--radius-md)] px-3 py-2
                           text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                           focus:outline-none focus:border-[var(--cinnabar)]/40
                           focus:shadow-[var(--shadow-focus)]
                           transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
              />
            ) : (
              <input
                type={spec.type === "url" ? "url" : "text"}
                value={params[spec.key] ?? ""}
                onChange={(e) =>
                  setParams((prev) => ({ ...prev, [spec.key]: e.target.value }))
                }
                placeholder={
                  language === "zh_CN" ? spec.placeholder_cn : spec.placeholder_en
                }
                className="block w-full bg-[var(--paper)] border border-[var(--paper-shadow)]
                           rounded-[var(--radius-md)] px-3 py-2
                           text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                           focus:outline-none focus:border-[var(--cinnabar)]/40
                           focus:shadow-[var(--shadow-focus)]
                           transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
              />
            )}
          </label>
        ))}
      </div>

      <div>
        <div className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
          Preview · 预览
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                        px-3.5 py-3 text-[13px] text-[var(--ink)] leading-[1.65] whitespace-pre-wrap break-words
                        italic">
          {preview || (
            <span className="text-[var(--ink-faint)] not-italic">Fill in the fields to preview.</span>
          )}
        </div>
      </div>

      {sendErr ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)] break-words">
          {sendErr}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend || sending}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                     border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                     text-[12px] tracking-[0.04em] font-medium
                     hover:bg-[var(--cinnabar-deep)]
                     focus-visible:shadow-[var(--shadow-focus)]
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-[background-color,opacity] duration-[var(--dur-fast)]"
        >
          {sending ? "Sending template…" : "Send template"}
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 5.5h7M6 2l3 3.5-3 3.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function LanguageToggle({
  value,
  onChange,
  available,
}: {
  value: TemplateLanguage;
  onChange: (l: TemplateLanguage) => void;
  available: readonly TemplateLanguage[];
}) {
  const options: Array<{ key: TemplateLanguage; label: string }> = [
    { key: "en_US", label: "EN" },
    { key: "zh_CN", label: "中文" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Template language"
      className="inline-flex rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt.key;
        const disabled = !available.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            className={`h-7 px-3 rounded-[var(--radius-pill)] text-[11px] tracking-[0.1em] uppercase
                        transition-[background-color,color] duration-[var(--dur-fast)]
                        ${active ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]" : "text-[var(--ink-mute)] hover:text-[var(--ink)]"}
                        disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ErrorBanner({
  text,
  code,
  onTemplates,
}: {
  text: string;
  code: "outside_window" | "provider" | null;
  onTemplates?: () => void;
}) {
  const isOutside = code === "outside_window";
  return (
    <div
      className={`mt-2 rounded-[var(--radius-md)] border px-3 py-2 text-[12px] break-words
        ${isOutside
          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          : "border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isOutside ? (
            <div className="font-medium mb-0.5">Outside the 24-hour customer service window</div>
          ) : null}
          <div className="opacity-90">{text}</div>
        </div>
        {onTemplates ? (
          <button
            type="button"
            onClick={onTemplates}
            className="flex-none inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)]
                       border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                       text-[10.5px] tracking-[0.1em] uppercase
                       hover:bg-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color] duration-[var(--dur-fast)]"
          >
            Use template
          </button>
        ) : null}
      </div>
    </div>
  );
}

