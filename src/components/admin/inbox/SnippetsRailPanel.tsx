"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  SNIPPET_VARIABLES,
  validateShortcut,
  type Snippet,
} from "@/lib/inbox/snippets-types";

// Snippets manager scoped to the thread right rail (~300px wide).
// Compact rows that stack vertically, slim toolbar, lazy-loaded list.
// Row click opens the same portalled editor modal used previously by the
// standalone /admin/snippets page (now removed in favour of this rail tab).

type DraftSnippet = {
  shortcut: string;
  title_en: string;
  title_zh: string;
  body_en: string;
  body_zh: string;
  description_en: string;
  description_zh: string;
};

const EMPTY_DRAFT: DraftSnippet = {
  shortcut: "",
  title_en: "",
  title_zh: "",
  body_en: "",
  body_zh: "",
  description_en: "",
  description_zh: "",
};

export function SnippetsRailPanel({ canWrite }: { canWrite: boolean }) {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Snippet | "new" | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await fetch("/api/admin/inbox/snippets", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        snippets?: Snippet[];
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setLoadErr(body.detail ?? body.error ?? `Load failed (${res.status})`);
        return;
      }
      setSnippets(body.snippets ?? []);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (snippets === null && !loading && !loadErr) {
      void load();
    }
  }, [snippets, loading, loadErr, load]);

  const filtered = useMemo(() => {
    if (!snippets) return [];
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter((s) =>
      [s.shortcut, s.title_en, s.title_zh, s.body_en, s.body_zh].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [snippets, query]);

  const handleSaved = useCallback(
    (saved: Snippet, mode: "create" | "update") => {
      setSnippets((prev) => {
        if (!prev) return [saved];
        if (mode === "create") return [saved, ...prev];
        return prev.map((s) => (s.id === saved.id ? saved : s));
      });
      setEditing(null);
    },
    [],
  );

  const handleDeleted = useCallback((id: string) => {
    setSnippets((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    setEditing(null);
  }, []);

  // Composer dispatches "inbox-open-snippet-editor" with optional shortcut
  // when admin clicks the slash menu's "Manage" affordance. We just open the
  // editor in "new" mode — the tab switch is handled by ThreadRightRail.
  useEffect(() => {
    function onOpen() {
      setEditing("new");
    }
    window.addEventListener("inbox-open-snippet-editor", onOpen);
    return () => window.removeEventListener("inbox-open-snippet-editor", onOpen);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <label className="flex-1 flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-pill)]
                          border border-[var(--paper-shadow)] bg-[var(--paper)]
                          focus-within:border-[var(--cinnabar)]/40 focus-within:shadow-[var(--shadow-focus)]
                          transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--ink-faint)] flex-none" aria-hidden="true">
            <circle cx="5" cy="5" r="3.5" />
            <path d="M7.5 7.5L10 10" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
          />
        </label>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            title="New snippet"
            className="flex-none inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-pill)]
                       border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                       hover:bg-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color] duration-[var(--dur-fast)]"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5.5 2v7M2 5.5h7" />
            </svg>
          </button>
        ) : null}
      </div>

      {loadErr ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[11.5px] text-[var(--cinnabar-deep)] flex items-start justify-between gap-2">
          <span className="min-w-0 break-words">{loadErr}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="flex-none text-[10px] tracking-[0.14em] uppercase underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : snippets === null || (loading && snippets === null) ? (
        <div className="text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] py-2 text-center">
          Loading snippets…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-3 py-5 text-center">
          <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--cinnabar)]/80 mb-1.5">
            {query ? "No match" : "Empty"}
          </div>
          <p className="text-[12px] text-[var(--ink-mute)] leading-[1.55]">
            {query
              ? "No snippets match that search."
              : canWrite
                ? "Create a snippet with the + button above. Drop it into any thread with /shortcut."
                : "No snippets yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((s) => (
            <li key={s.id}>
              <SnippetRow
                snippet={s}
                onOpen={() => (canWrite ? setEditing(s) : null)}
                canWrite={canWrite}
              />
            </li>
          ))}
        </ul>
      )}

      {snippets && snippets.length > 0 ? (
        <div className="pt-1 text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)] text-center">
          {snippets.length} snippet{snippets.length === 1 ? "" : "s"}
        </div>
      ) : null}

      {editing !== null ? (
        <SnippetEditorPortal
          snippet={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Compact row
// -----------------------------------------------------------------------------

function SnippetRow({
  snippet,
  onOpen,
  canWrite,
}: {
  snippet: Snippet;
  onOpen: () => void;
  canWrite: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!canWrite}
      className="group w-full text-left rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                 bg-[var(--paper)] px-2.5 py-2
                 hover:border-[var(--cinnabar)]/30 hover:bg-[var(--paper-warm)]
                 focus-visible:shadow-[var(--shadow-focus)]
                 disabled:cursor-default disabled:hover:border-[var(--paper-shadow)] disabled:hover:bg-[var(--paper)]
                 transition-[border-color,background-color] duration-[var(--dur-fast)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <code className="text-[11.5px] font-mono text-[var(--cinnabar)] truncate">
          /{snippet.shortcut}
        </code>
        {canWrite ? (
          <span className="flex-none text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)] group-hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]">
            Edit
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-[12px] leading-[1.35] text-[var(--ink)] truncate">
        {snippet.title_en}
        <span className="text-[var(--ink-mute)]"> · {snippet.title_zh}</span>
      </div>
    </button>
  );
}

// -----------------------------------------------------------------------------
// Editor modal — portalled to <body> so it escapes the 300px rail clipping
// (per feedback_dialog_portal in user's memory: dialogs nested in
// GPU-promoted ancestors need createPortal to document.body).
// -----------------------------------------------------------------------------

function SnippetEditorPortal(props: {
  snippet: Snippet | null;
  onClose: () => void;
  onSaved: (s: Snippet, mode: "create" | "update") => void;
  onDeleted: (id: string) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(<SnippetEditor {...props} />, document.body);
}

function SnippetEditor({
  snippet,
  onClose,
  onSaved,
  onDeleted,
}: {
  snippet: Snippet | null;
  onClose: () => void;
  onSaved: (s: Snippet, mode: "create" | "update") => void;
  onDeleted: (id: string) => void;
}) {
  const isNew = !snippet;
  const [draft, setDraft] = useState<DraftSnippet>(() =>
    snippet
      ? {
          shortcut: snippet.shortcut,
          title_en: snippet.title_en,
          title_zh: snippet.title_zh,
          body_en: snippet.body_en,
          body_zh: snippet.body_zh,
          description_en: snippet.description_en ?? "",
          description_zh: snippet.description_zh ?? "",
        }
      : EMPTY_DRAFT,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function update<K extends keyof DraftSnippet>(key: K, value: DraftSnippet[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // Close on Escape — keeps modal feel consistent with AiAssistPanel etc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shortcutErr = validateShortcut(draft.shortcut);
  const canSave =
    !saving &&
    !shortcutErr &&
    draft.title_en.trim() &&
    draft.title_zh.trim() &&
    draft.body_en.trim() &&
    draft.body_zh.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const url = isNew
        ? "/api/admin/inbox/snippets"
        : `/api/admin/inbox/snippets/${snippet!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shortcut: draft.shortcut.trim(),
          title_en: draft.title_en.trim(),
          title_zh: draft.title_zh.trim(),
          body_en: draft.body_en,
          body_zh: draft.body_zh,
          description_en: draft.description_en.trim() || null,
          description_zh: draft.description_zh.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        snippet?: Snippet;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.snippet) {
        setError(body.detail ?? body.error ?? `Save failed (${res.status})`);
        return;
      }
      onSaved(body.snippet, isNew ? "create" : "update");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!snippet) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/inbox/snippets/${snippet.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        setError(body.detail ?? body.error ?? `Delete failed (${res.status})`);
        return;
      }
      onDeleted(snippet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 py-8 md:py-12 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "New snippet" : `Edit ${snippet?.shortcut}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-[var(--ink)]/30 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="relative w-full max-w-3xl rounded-[var(--radius-lg)] border border-[var(--paper-shadow)]
                   bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)] overflow-hidden"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--paper-shadow)]">
          <div>
            <div className="text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              {isNew ? "New" : "Edit"} · {isNew ? "新增" : "编辑"}
            </div>
            <div className="mt-1 text-[18px] font-display text-[var(--ink)] tracking-[-0.01em]">
              {isNew ? "Create a snippet" : `/${snippet?.shortcut}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]
                       text-[11px] tracking-[0.1em] uppercase
                       hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30
                       transition-[border-color,color] duration-[var(--dur-fast)]"
          >
            Close
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px]">
          <div className="px-6 py-5 space-y-4 border-b md:border-b-0 md:border-r border-[var(--paper-shadow)]">
            <Field
              label_en="Shortcut"
              label_zh="快捷键"
              hint="lowercase letters, digits, hyphens"
              error={draft.shortcut && shortcutErr ? shortcutErr : null}
            >
              <div className="flex items-center gap-2">
                <span className="text-[var(--cinnabar)] font-mono text-[14px]">/</span>
                <input
                  type="text"
                  value={draft.shortcut}
                  onChange={(e) =>
                    update("shortcut", e.target.value.toLowerCase().replace(/\s+/g, "-"))
                  }
                  placeholder="refund-policy"
                  className="flex-1 bg-[var(--paper)] border border-[var(--paper-shadow)] rounded-[var(--radius-md)]
                             px-3 py-2 text-[13px] font-mono text-[var(--ink)]
                             placeholder:text-[var(--ink-faint)] placeholder:font-mono
                             focus:outline-none focus:border-[var(--cinnabar)]/40
                             focus:shadow-[var(--shadow-focus)]
                             transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
                />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label_en="Title" label_zh="标题" hint="EN">
                <input
                  type="text"
                  value={draft.title_en}
                  onChange={(e) => update("title_en", e.target.value)}
                  placeholder="Refund policy"
                  className={inputCls}
                />
              </Field>
              <Field label_en="Title" label_zh="标题" hint="中">
                <input
                  type="text"
                  value={draft.title_zh}
                  onChange={(e) => update("title_zh", e.target.value)}
                  placeholder="退款政策"
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label_en="Description" label_zh="说明" hint="EN · optional">
                <input
                  type="text"
                  value={draft.description_en}
                  onChange={(e) => update("description_en", e.target.value)}
                  placeholder="Used for refund-related questions"
                  className={inputCls}
                />
              </Field>
              <Field label_en="Description" label_zh="说明" hint="中 · 可选">
                <input
                  type="text"
                  value={draft.description_zh}
                  onChange={(e) => update("description_zh", e.target.value)}
                  placeholder="用于退款相关问题"
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label_en="Body" label_zh="正文" hint="EN">
              <textarea
                value={draft.body_en}
                onChange={(e) => update("body_en", e.target.value)}
                rows={5}
                placeholder="Hi {name}, our refund policy for {event_title}…"
                className={textareaCls}
              />
            </Field>

            <Field label_en="Body" label_zh="正文" hint="中文">
              <textarea
                value={draft.body_zh}
                onChange={(e) => update("body_zh", e.target.value)}
                rows={5}
                placeholder="您好 {name_zh}，{event_title_zh} 的退款政策……"
                className={textareaCls}
              />
            </Field>
          </div>

          <aside className="px-5 py-5 bg-[var(--paper)]/40">
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-faint)] mb-2">
              Variables · 变量
            </div>
            <p className="text-[11.5px] text-[var(--ink-mute)] leading-[1.55] mb-3">
              Insert any of these tokens in your body. They&apos;ll be filled in from the conversation participant + their most-recent enrolment.
            </p>
            <ul className="space-y-1.5">
              {SNIPPET_VARIABLES.map((v) => (
                <li key={v.key}>
                  <code className="block text-[11.5px] font-mono text-[var(--cinnabar-deep)]">
                    {`{${v.key}}`}
                  </code>
                  <div className="text-[10.5px] text-[var(--ink-faint)] mt-0.5">
                    {v.label_en} · {v.label_zh}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {error ? (
          <div className="mx-6 mb-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3 py-2 text-[12px] text-[var(--cinnabar-deep)]">
            {error}
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--paper-shadow)] bg-[var(--paper)]/40">
          <div>
            {!isNew && snippet ? (
              confirmDelete ? (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="text-[var(--ink-soft)]">Delete this snippet?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)]
                               border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                               text-[11px] tracking-[0.06em] uppercase
                               hover:bg-[var(--cinnabar-deep)] disabled:opacity-40
                               transition-[background-color] duration-[var(--dur-fast)]"
                  >
                    {deleting ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)]
                               text-[var(--ink-mute)] hover:text-[var(--ink)]
                               text-[11px] tracking-[0.06em] uppercase
                               transition-colors duration-[var(--dur-fast)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)]
                             text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)]
                             text-[11px] tracking-[0.1em] uppercase
                             transition-colors duration-[var(--dur-fast)]"
                >
                  Delete
                </button>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]
                         text-[12px] tracking-[0.06em] uppercase
                         hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30
                         disabled:opacity-40
                         transition-[border-color,color] duration-[var(--dur-fast)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)]
                         border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                         text-[12px] tracking-[0.04em] font-medium
                         hover:bg-[var(--cinnabar-deep)]
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-[background-color,opacity] duration-[var(--dur-fast)]"
            >
              {saving ? "Saving…" : isNew ? "Create snippet" : "Save changes"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  "block w-full bg-[var(--paper)] border border-[var(--paper-shadow)] rounded-[var(--radius-md)] px-3 py-2 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

const textareaCls =
  "block w-full resize-y bg-[var(--paper)] border border-[var(--paper-shadow)] rounded-[var(--radius-md)] px-3 py-2 text-[13px] leading-[1.6] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] font-mono";

function Field({
  label_en,
  label_zh,
  hint,
  error,
  children,
}: {
  label_en: string;
  label_zh: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
          {label_en} · {label_zh}
        </span>
        {hint ? (
          <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <div className="mt-1 text-[11px] text-[var(--cinnabar-deep)]">{error}</div>
      ) : null}
    </label>
  );
}
