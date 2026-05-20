"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Right-edge slide-in drawer with three admin-triggered AI actions:
//   - Draft   : streams a suggested reply based on the thread (target language
//               auto-matched to participant). Admin reviews + clicks "Insert
//               into composer" to push it into the textarea. Nothing sends.
//   - Summary : 3-5 bullet English summary of the thread for fast triage.
//   - Translate: free-form translator (EN ↔ CN). Admin pastes text or pulls
//               from the composer. Auto-detects target; can be overridden.
//
// All actions hit /api/admin/inbox/[id]/ai/*. Drafts are streamed — the rest
// are JSON. Insert dispatches a window CustomEvent that MessageComposer
// listens for and appends to its textarea state.

type Action = "draft" | "summarize" | "translate";

type Props = {
  conversationId: string;
};

export function AiAssistPanel({ conversationId }: Props) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);

  // Translate-specific state.
  const [translateInput, setTranslateInput] = useState("");
  const [translateTarget, setTranslateTarget] = useState<"auto" | "en" | "zh">(
    "auto",
  );

  const abortRef = useRef<AbortController | null>(null);
  const resultBoxRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setAction(null);
    setResult("");
    setError(null);
    setStreaming(false);
    setCopied(false);
    setInserted(false);
  }, []);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
  }, []);

  // Auto-scroll result box as draft streams in.
  useEffect(() => {
    if (streaming && resultBoxRef.current) {
      resultBoxRef.current.scrollTop = resultBoxRef.current.scrollHeight;
    }
  }, [result, streaming]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Abort any in-flight stream when the drawer unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function runDraft() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAction("draft");
    setStreaming(true);
    setResult("");
    setError(null);
    setCopied(false);
    setInserted(false);

    try {
      const res = await fetch(
        `/api/admin/inbox/${conversationId}/ai/draft`,
        { method: "POST", signal: ac.signal },
      );
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const detail =
          typeof body.detail === "string"
            ? (body.detail as string)
            : typeof body.error === "string"
              ? (body.error as string)
              : `Draft failed (${res.status})`;
        setError(detail);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setResult((prev) => prev + chunk);
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Network error");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function runSummarize() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAction("summarize");
    setStreaming(true);
    setResult("");
    setError(null);
    setCopied(false);
    setInserted(false);

    try {
      const res = await fetch(
        `/api/admin/inbox/${conversationId}/ai/summarize`,
        { method: "POST", signal: ac.signal },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail =
          typeof body.detail === "string"
            ? (body.detail as string)
            : typeof body.error === "string"
              ? (body.error as string)
              : `Summary failed (${res.status})`;
        setError(detail);
        return;
      }
      setResult(typeof body.summary === "string" ? (body.summary as string) : "");
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Network error");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function runTranslate() {
    const text = translateInput.trim();
    if (!text) {
      setError("Paste or type some text to translate.");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAction("translate");
    setStreaming(true);
    setResult("");
    setError(null);
    setCopied(false);
    setInserted(false);

    try {
      const res = await fetch(
        `/api/admin/inbox/${conversationId}/ai/translate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text,
            target: translateTarget === "auto" ? undefined : translateTarget,
          }),
          signal: ac.signal,
        },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const detail =
          typeof body.detail === "string"
            ? (body.detail as string)
            : typeof body.error === "string"
              ? (body.error as string)
              : `Translate failed (${res.status})`;
        setError(detail);
        return;
      }
      setResult(
        typeof body.translated === "string" ? (body.translated as string) : "",
      );
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Network error");
      }
    } finally {
      setStreaming(false);
    }
  }

  function pullFromComposer() {
    const el = document.getElementById("inbox-composer") as HTMLTextAreaElement | null;
    if (el && el.value.trim()) setTranslateInput(el.value);
  }

  function insertIntoComposer() {
    if (!result.trim()) return;
    window.dispatchEvent(
      new CustomEvent("inbox-composer-insert", {
        detail: { text: result.trim() },
      }),
    );
    setInserted(true);
    window.setTimeout(() => setInserted(false), 1600);
  }

  async function copyResult() {
    if (!result.trim()) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API can fail in non-secure contexts; quietly ignore.
    }
  }

  return (
    <>
      {/* Trigger button — sits in the thread header next to AI Assistant toggle. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                   border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]
                   text-[10.5px] tracking-[0.18em] uppercase
                   hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
      >
        <SparkleIcon />
        AI Assist · 助手
      </button>

      {/* Backdrop + drawer */}
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-[var(--ink)]/20
                    transition-opacity duration-[var(--dur-base)]
                    ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={close}
      />
      <aside
        role="dialog"
        aria-label="AI Assist"
        aria-hidden={!open}
        className={`fixed right-0 top-0 bottom-0 z-50
                    w-[min(480px,92vw)]
                    bg-[var(--paper-warm)] border-l border-[var(--paper-shadow)]
                    shadow-[var(--shadow-paper-2)]
                    flex flex-col
                    transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]
                    ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--paper-shadow)]">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              AI Assist · 助手
            </div>
            <h2 className="mt-1.5 font-display text-[18px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
              Draft. Summarize. Translate.
            </h2>
            <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.55]">
              Sonnet 4.6 · region_id-tokenized, never sends on its own.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close AI Assist"
            className="flex-none inline-flex items-center justify-center w-8 h-8 rounded-full
                       text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-colors duration-[var(--dur-fast)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </header>

        {/* Action grid */}
        <div className="px-5 pt-4 pb-3 grid grid-cols-3 gap-2">
          <ActionTile
            label="Draft"
            cn="拟稿"
            description="Suggest a reply"
            active={action === "draft"}
            disabled={streaming}
            onClick={runDraft}
          >
            <SparkleIcon />
          </ActionTile>
          <ActionTile
            label="Summary"
            cn="摘要"
            description="Triage in 5 lines"
            active={action === "summarize"}
            disabled={streaming}
            onClick={runSummarize}
          >
            <ListIcon />
          </ActionTile>
          <ActionTile
            label="Translate"
            cn="翻译"
            description="EN ↔ 中文"
            active={action === "translate"}
            disabled={streaming}
            onClick={() => {
              setAction("translate");
              setResult("");
              setError(null);
            }}
          >
            <GlobeIcon />
          </ActionTile>
        </div>

        {/* Action body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 flex flex-col gap-3">
          {action === "translate" ? (
            <TranslatePanel
              input={translateInput}
              setInput={setTranslateInput}
              target={translateTarget}
              setTarget={setTranslateTarget}
              onPull={pullFromComposer}
              onRun={runTranslate}
              running={streaming}
            />
          ) : null}

          {action ? (
            <ResultArea
              ref={resultBoxRef}
              action={action}
              streaming={streaming}
              result={result}
              error={error}
              onRetry={
                action === "draft"
                  ? runDraft
                  : action === "summarize"
                    ? runSummarize
                    : runTranslate
              }
            />
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Footer actions — visible when there's a result to act on */}
        {action && result && !streaming && !error ? (
          <footer className="border-t border-[var(--paper-shadow)] px-5 py-3 flex items-center justify-between gap-3 bg-[var(--paper)]">
            <button
              type="button"
              onClick={copyResult}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)]
                         text-[11px] tracking-[0.1em] uppercase
                         hover:border-[var(--cinnabar)]/30 hover:text-[var(--ink)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[border-color,color] duration-[var(--dur-fast)]"
            >
              <CopyIcon />
              {copied ? "Copied" : "Copy"}
            </button>
            {action !== "summarize" ? (
              <button
                type="button"
                onClick={insertIntoComposer}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                           border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                           text-[12px] tracking-[0.04em] font-medium
                           hover:bg-[var(--cinnabar-deep)]
                           focus-visible:shadow-[var(--shadow-focus)]
                           transition-[background-color] duration-[var(--dur-fast)]"
              >
                {inserted ? "Inserted →" : "Insert into composer"}
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 5.5h7M6 2l3 3.5-3 3.5" />
                </svg>
              </button>
            ) : (
              <span className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
                Summary · admin only
              </span>
            )}
          </footer>
        ) : null}
      </aside>
    </>
  );
}

// -----------------------------------------------------------------------------
// Action tile
// -----------------------------------------------------------------------------

function ActionTile({
  label,
  cn,
  description,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  cn: string;
  description: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex flex-col items-start gap-1 rounded-[var(--radius-md)] border
                  px-3 py-3 text-left
                  focus-visible:shadow-[var(--shadow-focus)]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-[border-color,background-color,transform] duration-[var(--dur-fast)]
                  ${active
                    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper)] hover:border-[var(--cinnabar)]/30 hover:-translate-y-px"}
                `}
    >
      <span
        className={`flex items-center justify-center w-7 h-7 rounded-full
          ${active
            ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]"
            : "bg-[var(--paper-warm)] text-[var(--cinnabar)] border border-[var(--paper-shadow)]"}
        `}
      >
        {children}
      </span>
      <span className="mt-1.5 text-[12.5px] font-display text-[var(--ink)] tracking-[-0.005em]">
        {label}
        <span className="ml-1.5 text-[10.5px] text-[var(--ink-mute)] font-sans tracking-[0.02em]">
          {cn}
        </span>
      </span>
      <span className="text-[10.5px] text-[var(--ink-faint)] tracking-[0.04em] leading-[1.4]">
        {description}
      </span>
    </button>
  );
}

// -----------------------------------------------------------------------------
// Translate input panel
// -----------------------------------------------------------------------------

function TranslatePanel({
  input,
  setInput,
  target,
  setTarget,
  onPull,
  onRun,
  running,
}: {
  input: string;
  setInput: (v: string) => void;
  target: "auto" | "en" | "zh";
  setTarget: (t: "auto" | "en" | "zh") => void;
  onPull: () => void;
  onRun: () => void;
  running: boolean;
}) {
  const options: Array<{ key: "auto" | "en" | "zh"; label: string }> = [
    { key: "auto", label: "Auto" },
    { key: "en", label: "EN" },
    { key: "zh", label: "中文" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Source text · 原文
        </span>
        <button
          type="button"
          onClick={onPull}
          className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
        >
          Pull from composer ↑
        </button>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder="Paste text in English or 中文..."
        className="block w-full resize-y bg-[var(--paper)] border border-[var(--paper-shadow)]
                   rounded-[var(--radius-md)] px-3 py-2
                   text-[13px] leading-[1.55] text-[var(--ink)] placeholder:text-[var(--ink-faint)]
                   focus:outline-none focus:border-[var(--cinnabar)]/40
                   focus:shadow-[var(--shadow-focus)]
                   transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          role="tablist"
          aria-label="Translation target"
          className="inline-flex rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-0.5"
        >
          {options.map((opt) => {
            const active = target === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTarget(opt.key)}
                className={`h-7 px-3 rounded-[var(--radius-pill)] text-[11px] tracking-[0.1em] uppercase
                            transition-[background-color,color] duration-[var(--dur-fast)]
                            ${active
                              ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                              : "text-[var(--ink-mute)] hover:text-[var(--ink)]"}
                          `}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running || !input.trim()}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                     border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                     text-[12px] tracking-[0.04em] font-medium
                     hover:bg-[var(--cinnabar-deep)]
                     focus-visible:shadow-[var(--shadow-focus)]
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-[background-color,opacity] duration-[var(--dur-fast)]"
        >
          {running ? "Translating…" : "Translate"}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Result area
// -----------------------------------------------------------------------------

const ResultArea = function ResultArea({
  ref,
  action,
  streaming,
  result,
  error,
  onRetry,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  action: Action;
  streaming: boolean;
  result: string;
  error: string | null;
  onRetry: () => void;
}) {
  const label =
    action === "draft"
      ? "Suggested reply · 草稿"
      : action === "summarize"
        ? "Thread summary · 摘要"
        : "Translation · 译文";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          {label}
        </span>
        {streaming ? (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.14em] uppercase text-[var(--cinnabar)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)] animate-pulse" />
            Streaming…
          </span>
        ) : null}
      </div>
      <div
        ref={ref}
        className="min-h-[120px] max-h-[360px] overflow-y-auto rounded-[var(--radius-md)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   px-3.5 py-3 text-[13.5px] leading-[1.65] text-[var(--ink)]
                   whitespace-pre-wrap break-words"
      >
        {error ? (
          <div className="text-[var(--cinnabar-deep)]">
            <div className="text-[10.5px] tracking-[0.16em] uppercase mb-1">Error</div>
            <div className="text-[12.5px] leading-[1.6]">{error}</div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-[10.5px] tracking-[0.14em] uppercase underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : result ? (
          <span>
            {result}
            {streaming ? <span className="gmc-typing-caret" aria-hidden="true" /> : null}
          </span>
        ) : streaming ? (
          <span className="text-[var(--ink-faint)] italic">Thinking…</span>
        ) : (
          <span className="text-[var(--ink-faint)] italic">No output yet.</span>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Empty state — shown before any action is picked.
// -----------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 gap-3">
      <div className="w-12 h-12 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] flex items-center justify-center text-[var(--cinnabar)]">
        <SparkleIcon />
      </div>
      <div>
        <div className="text-[12.5px] font-display text-[var(--ink)] tracking-[-0.005em]">
          Pick an action above
        </div>
        <div className="mt-1 text-[11px] text-[var(--ink-mute)] leading-[1.55] max-w-[280px] mx-auto">
          AI Assist reads only this thread — and refers to the participant by
          region_id, never by name or contact info.
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Icons (inline so we don't pull in an icon dep)
// -----------------------------------------------------------------------------

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 1.5v3M6 7.5v3M1.5 6h3M7.5 6h3M3 3l1.5 1.5M7.5 7.5L9 9M9 3L7.5 4.5M4.5 7.5L3 9" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 3.5h6M4 6h6M4 8.5h4" />
      <circle cx="2" cy="3.5" r="0.6" fill="currentColor" />
      <circle cx="2" cy="6" r="0.6" fill="currentColor" />
      <circle cx="2" cy="8.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M1.5 6h9M6 1.5c1.5 2 1.5 7 0 9M6 1.5c-1.5 2-1.5 7 0 9" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <path d="M4 9.5h5a1 1 0 0 0 1-1V4" />
    </svg>
  );
}
