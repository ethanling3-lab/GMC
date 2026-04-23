"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { channelLabel } from "@/lib/inbox/format";
import { ChannelGlyph } from "./ChannelGlyph";
import type {
  TemplateLanguage,
  TemplateSummary,
} from "@/lib/inbox/whatsapp-templates-types";

// Reply composer. Two modes:
//   - text: default free-form textarea (WhatsApp 24h window + LINE + future)
//   - template: WhatsApp-only HSM template picker. Opens via the Templates
//     button; auto-opens when a text send returns error_code=outside_window.
//
// UX:
//   - Enter to send in text mode, Shift+Enter for newline
//   - Optimistic: clear textarea immediately, router.refresh() pulls the real
//     row from the server
//   - On send failure, text is restored + error banner
//   - Outside-24h banner hands the admin directly into the template flow

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
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<"outside_window" | "provider" | null>(null);
  const [isPending, startTransition] = useTransition();

  const canUseTemplates = channel === "whatsapp";
  const [mode, setMode] = useState<"text" | "template">("text");

  // Auto-grow the textarea. Cap the growth so the thread above stays visible.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || mode !== "text") return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, mode]);

  const sendText = useCallback(async () => {
    const body = value.trim();
    if (!body || sending || disabled) return;
    const snapshot = value;
    setSending(true);
    setError(null);
    setErrorCode(null);
    setValue("");
    try {
      const res = await fetch(`/api/admin/inbox/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body_text: body }),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail = typeof payload.detail === "string"
          ? (payload.detail as string)
          : typeof payload.error === "string"
            ? (payload.error as string)
            : `Send failed (${res.status})`;
        setError(detail);
        setValue(snapshot);
        return;
      }
      const softError = typeof payload.error === "string" ? (payload.error as string) : null;
      const code = typeof payload.error_code === "string" ? (payload.error_code as string) : null;
      if (softError) {
        setError(softError);
        if (code === "outside_window") {
          setErrorCode("outside_window");
          // Keep the draft so the admin can turn it into a template body.
          setValue(snapshot);
          if (canUseTemplates) setMode("template");
        } else if (code === "provider") {
          setErrorCode("provider");
        }
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setValue(snapshot);
    } finally {
      setSending(false);
    }
  }, [canUseTemplates, conversationId, disabled, router, sending, value]);

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
          onSend={sendText}
          textareaRef={textareaRef}
          canUseTemplates={canUseTemplates}
          onOpenTemplates={() => {
            setMode("template");
            setError(null);
            setErrorCode(null);
          }}
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
            ) : null
          }
        />
      )}
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
  errorBanner: React.ReactNode;
}) {
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
          placeholder={`Reply via ${channelLabel(channel)}… (Shift+Enter for newline)`}
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
        {errorBanner}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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
            ) : (
              <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                AI drafts · attachments ship later
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={busy || value.trim().length === 0}
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
  const [params, setParams] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (participantName) init.name = participantName;
    return init;
  });
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  // Load the registry once when the panel mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/inbox/templates", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as {
          templates?: TemplateSummary[];
          detail?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadErr(body.detail ?? body.error ?? `Load failed (${res.status})`);
          return;
        }
        setTemplates(body.templates ?? []);
      } catch (err) {
        if (cancelled) return;
        setLoadErr(err instanceof Error ? err.message : "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ensure the selected template supports the chosen language; snap back if not.
  useEffect(() => {
    if (!selected) return;
    if (!selected.languages.includes(language)) {
      setLanguage(selected.languages[0]);
    }
  }, [selected, language]);

  // When admin picks a template, seed `name` from participant if not set yet.
  useEffect(() => {
    if (!selected) return;
    setParams((prev) => {
      const next = { ...prev };
      if (!next.name && participantName) next.name = participantName;
      return next;
    });
  }, [selected, participantName]);

  const preview = useMemo(() => {
    if (!selected) return "";
    return renderPreview(selected.name, language, params);
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
      {/* Header strip */}
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
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)]">
          {loadErr}
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
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Template list
// -----------------------------------------------------------------------------

function TemplateList({
  templates,
  onSelect,
}: {
  templates: TemplateSummary[];
  onSelect: (t: TemplateSummary) => void;
}) {
  if (templates.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-5 text-[12.5px] text-[var(--ink-mute)]">
        No templates are registered yet. Submit templates in Meta Business Manager, then add them to <code className="font-mono text-[11.5px]">src/lib/inbox/whatsapp-templates.ts</code>.
      </div>
    );
  }

  return (
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
  );
}

// -----------------------------------------------------------------------------
// Template form: language toggle + param fields + preview + send
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Shared error banner
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Client-side preview renderer. Kept minimal + local so the preview updates
// instantly as the admin types — we don't round-trip to the server for it.
// Must stay aligned with the `render` functions in the server registry.
// -----------------------------------------------------------------------------

function renderPreview(
  templateName: string,
  language: TemplateLanguage,
  params: Record<string, string>,
): string {
  const n = (k: string) => (params[k] ?? "").trim();
  const isZh = language === "zh_CN";

  switch (templateName) {
    case "gmc_enrollment_approved":
      return isZh
        ? `${n("name")}，您的 GMC 报名「${n("event_title")}」已获批准。应付金额：${n("amount")}。付款链接：${n("payment_url")}`
        : `Dear ${n("name")}, your GMC registration for ${n("event_title")} is approved. Amount due: ${n("amount")}. Complete payment: ${n("payment_url")}`;
    case "gmc_payment_received":
      return isZh
        ? `${n("name")}，已收到您的付款「${n("event_title")}」。金额：${n("amount")}。`
        : `${n("name")}, we've received your payment for ${n("event_title")}. Amount: ${n("amount")}.`;
    case "gmc_enrollment_rejected_no_seats":
    case "gmc_enrollment_rejected_duplicate":
    case "gmc_enrollment_rejected_unsuitable":
    case "gmc_enrollment_rejected_other":
      return isZh
        ? `${n("name")}，关于您的 GMC 报名「${n("event_title")}」— 很遗憾无法确认本次席位。`
        : `Dear ${n("name")}, regarding your GMC registration for ${n("event_title")} — we're unable to confirm a seat this time.`;
    default:
      // Fallback — concatenate params so the admin still sees what will be sent.
      return Object.values(params).filter((v) => v.trim()).join(" · ");
  }
}
