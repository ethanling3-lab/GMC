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
import { TagChip } from "./TagChip";
import {
  deriveSlug,
  validateColor,
  type Tag,
} from "@/lib/inbox/tags-types";

// Chip strip rendered below the thread header. Shows currently-applied
// tags + a "+ Tag · 标签" affordance that opens a Linear/Intercom-style
// picker: search existing or type a new label + pick a colour to create.
//
// State model:
//   - `appliedSlugs` is the source of truth for what's on the conversation
//     (server-supplied, then reconciled with API responses).
//   - `allTags` is the org-wide tag definition list, lazy-loaded on first
//     picker open + refreshed whenever a new tag is created.
//
// All writes go through the existing role-gated tag routes
// (POST/DELETE /api/admin/inbox/[id]/tags[/slug] + POST /api/admin/inbox/tags).

export function ConversationTagStrip({
  conversationId,
  initialAppliedSlugs,
  initialTags,
  canWrite,
}: {
  conversationId: string;
  initialAppliedSlugs: string[];
  initialTags: Tag[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [appliedSlugs, setAppliedSlugs] = useState<string[]>(initialAppliedSlugs);
  const [allTags, setAllTags] = useState<Tag[]>(initialTags);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const tagsBySlug = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const t of allTags) map.set(t.slug, t);
    return map;
  }, [allTags]);

  const appliedTags = useMemo(
    () =>
      appliedSlugs.map((slug) => ({
        slug,
        tag: tagsBySlug.get(slug),
      })),
    [appliedSlugs, tagsBySlug],
  );

  const handleRemove = useCallback(
    async (slug: string) => {
      setError(null);
      const prev = appliedSlugs;
      setAppliedSlugs((s) => s.filter((x) => x !== slug));
      try {
        const res = await fetch(
          `/api/admin/inbox/${conversationId}/tags/${encodeURIComponent(slug)}`,
          { method: "DELETE" },
        );
        const body = (await res.json().catch(() => ({}))) as {
          tags?: string[];
          detail?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(body.detail ?? body.error ?? `Remove failed (${res.status})`);
          setAppliedSlugs(prev);
          return;
        }
        if (Array.isArray(body.tags)) setAppliedSlugs(body.tags);
        startTransition(() => router.refresh());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        setAppliedSlugs(prev);
      }
    },
    [appliedSlugs, conversationId, router],
  );

  const handleApply = useCallback(
    async (slug: string) => {
      setError(null);
      const prev = appliedSlugs;
      if (!prev.includes(slug)) setAppliedSlugs((s) => [...s, slug]);
      setPickerOpen(false);
      try {
        const res = await fetch(`/api/admin/inbox/${conversationId}/tags`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          tags?: string[];
          detail?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(body.detail ?? body.error ?? `Apply failed (${res.status})`);
          setAppliedSlugs(prev);
          return;
        }
        if (Array.isArray(body.tags)) setAppliedSlugs(body.tags);
        startTransition(() => router.refresh());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
        setAppliedSlugs(prev);
      }
    },
    [appliedSlugs, conversationId, router],
  );

  const handleCreate = useCallback(
    async (input: { slug: string; label_en: string; label_zh: string; color: string }) => {
      setError(null);
      try {
        const createRes = await fetch("/api/admin/inbox/tags", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const createBody = (await createRes.json().catch(() => ({}))) as {
          tag?: Tag;
          detail?: string;
          error?: string;
        };
        if (!createRes.ok || !createBody.tag) {
          setError(createBody.detail ?? createBody.error ?? `Create failed (${createRes.status})`);
          return;
        }
        setAllTags((t) => [createBody.tag!, ...t.filter((x) => x.id !== createBody.tag!.id)]);
        await handleApply(createBody.tag.slug);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    },
    [handleApply],
  );

  // No tags + no write permission → render nothing (don't take vertical space).
  if (!canWrite && appliedSlugs.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative flex-none flex items-center gap-1.5 px-5 py-2 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)]"
    >
      <span
        aria-hidden="true"
        className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mr-1 flex-none"
      >
        Tags
      </span>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {appliedTags.map(({ slug, tag }) =>
          tag ? (
            <TagChip
              key={slug}
              label={tag.label_en}
              title={`${tag.label_en} · ${tag.label_zh}`}
              color={tag.color}
              variant="ghost"
              onRemove={canWrite ? () => handleRemove(slug) : undefined}
            />
          ) : (
            <TagChip
              key={slug}
              label={slug}
              title={`Orphan tag "${slug}" — definition was deleted`}
              color="#8c8c8c"
              variant="ghost"
              onRemove={canWrite ? () => handleRemove(slug) : undefined}
            />
          ),
        )}
        {canWrite ? (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-pill)]
                       border border-dashed border-[var(--paper-shadow)] bg-transparent
                       text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)]
                       hover:text-[var(--cinnabar)] hover:border-[var(--cinnabar)]/30
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[border-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5.5 2v7M2 5.5h7" />
            </svg>
            Tag · 标签
          </button>
        ) : null}
      </div>
      {error ? (
        <span className="ml-auto flex-none text-[10.5px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}

      {pickerOpen ? (
        <TagPicker
          tags={allTags}
          appliedSlugs={appliedSlugs}
          onApply={handleApply}
          onCreate={handleCreate}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Picker popover
// -----------------------------------------------------------------------------

const DEFAULT_PALETTE = [
  "#A53A1F", // cinnabar deep
  "#C97E5B", // warm clay
  "#7A8B5A", // sage
  "#5B7FB0", // editorial blue
  "#9C7AB5", // lavender
  "#C9A23B", // mustard
];

function pickStartingColor() {
  return DEFAULT_PALETTE[Math.floor(Math.random() * DEFAULT_PALETTE.length)];
}

function TagPicker({
  tags,
  appliedSlugs,
  onApply,
  onCreate,
  onClose,
}: {
  tags: Tag[];
  appliedSlugs: string[];
  onApply: (slug: string) => void;
  onCreate: (input: {
    slug: string;
    label_en: string;
    label_zh: string;
    color: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [color, setColor] = useState<string>(() => pickStartingColor());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim();
  const qLower = q.toLowerCase();

  const filteredTags = useMemo(() => {
    if (!q) return tags.slice(0, 50);
    return tags
      .filter(
        (t) =>
          t.slug.toLowerCase().includes(qLower) ||
          t.label_en.toLowerCase().includes(qLower) ||
          t.label_zh.includes(q),
      )
      .sort((a, b) => {
        const ap = a.slug.toLowerCase().startsWith(qLower) ? 0 : 1;
        const bp = b.slug.toLowerCase().startsWith(qLower) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 50);
  }, [tags, q, qLower]);

  const slugFromQuery = q ? deriveSlug(q) : null;
  const exactSlugMatch = q
    ? tags.some((t) => t.slug.toLowerCase() === qLower)
    : false;
  const canCreate =
    Boolean(slugFromQuery) && !exactSlugMatch && validateColor(color) === null;

  const items: Array<
    | { kind: "tag"; tag: Tag }
    | { kind: "create"; slug: string }
  > = useMemo(() => {
    const out: Array<
      | { kind: "tag"; tag: Tag }
      | { kind: "create"; slug: string }
    > = filteredTags.map((t) => ({ kind: "tag" as const, tag: t }));
    if (canCreate && slugFromQuery) {
      out.push({ kind: "create" as const, slug: slugFromQuery });
    }
    return out;
  }, [filteredTags, canCreate, slugFromQuery]);

  useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(Math.max(0, items.length - 1));
  }, [items.length, selectedIdx]);

  async function commitItem(item: (typeof items)[number]) {
    if (item.kind === "tag") {
      onApply(item.tag.slug);
      return;
    }
    if (!slugFromQuery) return;
    setCreating(true);
    try {
      await onCreate({
        slug: slugFromQuery,
        label_en: q,
        label_zh: q,
        color,
      });
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIdx];
      if (item) void commitItem(item);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Pick or create a tag"
      className="absolute left-5 top-full mt-1.5 z-30 w-[340px]
                 rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                 bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[var(--paper-shadow)] flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search or create a tag…"
          className="flex-1 bg-transparent border-none outline-none text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        <label
          className="flex-none inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] cursor-pointer overflow-hidden"
          title={`Colour: ${color}`}
          style={{ backgroundColor: color }}
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value.toUpperCase())}
            className="opacity-0 absolute w-7 h-7 cursor-pointer"
          />
        </label>
      </div>

      <ul className="max-h-[280px] overflow-y-auto py-1">
        {items.length === 0 ? (
          <li className="px-3 py-3 text-[11.5px] text-[var(--ink-mute)]">
            {q
              ? "No matches — pick a colour and press Enter to create."
              : "No tags yet. Type a name to create one."}
          </li>
        ) : (
          items.map((item, i) => {
            const active = i === selectedIdx;
            const isCreate = item.kind === "create";
            return (
              <li key={isCreate ? `create-${item.slug}` : item.tag.id}>
                <button
                  type="button"
                  onClick={() => void commitItem(item)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  disabled={creating}
                  className={[
                    "w-full text-left px-3 py-2 flex items-center justify-between gap-3",
                    "transition-[background-color] duration-[var(--dur-fast)]",
                    active ? "bg-[var(--cinnabar-wash)]" : "hover:bg-[var(--paper)]",
                    creating ? "opacity-50 cursor-wait" : "",
                  ].join(" ")}
                >
                  {isCreate ? (
                    <>
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          className="flex-none w-2 h-2 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-[12.5px] text-[var(--ink)] truncate">
                          Create &ldquo;<strong className="font-display">{q}</strong>&rdquo;
                          <span className="text-[var(--ink-mute)] font-mono"> /{item.slug}</span>
                        </span>
                      </span>
                      <span className="flex-none text-[9.5px] tracking-[0.18em] uppercase text-[var(--cinnabar)]">
                        New ↵
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          className="flex-none w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.tag.color }}
                        />
                        <span className="text-[12.5px] text-[var(--ink)] truncate">
                          {item.tag.label_en}
                          <span className="text-[var(--ink-mute)]"> · {item.tag.label_zh}</span>
                        </span>
                      </span>
                      {appliedSlugs.includes(item.tag.slug) ? (
                        <span className="flex-none text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                          Applied
                        </span>
                      ) : active ? (
                        <span className="flex-none text-[9.5px] tracking-[0.18em] uppercase text-[var(--cinnabar)]">
                          ↵
                        </span>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="px-3 py-1.5 border-t border-[var(--paper-shadow)] bg-[var(--paper)]/60 flex items-center justify-between text-[9.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
        <span>↑↓ select · ↵ apply · Esc close</span>
        <span className="font-mono normal-case text-[10px]" style={{ color }}>
          {color}
        </span>
      </div>
    </div>
  );
}
