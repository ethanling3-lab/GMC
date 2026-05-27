"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Keyboard shortcut overlay — triggered by `?`. Same scrim + paper card
// treatment as other admin modals (Esc/click-outside to dismiss, body
// scroll lock). Portaled to <body> to escape any GPU-promoted ancestor
// that would clip a position:fixed child — same lesson learned in the
// floor-plan ExportDialog.

const SHORTCUTS: Array<{ keys: string[]; en: string; cn: string }> = [
  { keys: ["j", "↓"], en: "Next thread", cn: "下一条" },
  { keys: ["k", "↑"], en: "Previous thread", cn: "上一条" },
  { keys: ["Enter"], en: "Open focused thread", cn: "打开" },
  { keys: ["x", "Space"], en: "Select / unselect", cn: "选择 / 取消" },
  { keys: ["⌘", "A"], en: "Select all visible", cn: "全选" },
  { keys: ["e"], en: "Mark read (selected or focused)", cn: "标记已读" },
  { keys: ["Esc"], en: "Clear selection / close this", cn: "清除 / 关闭" },
  { keys: ["?"], en: "Show this cheatsheet", cn: "显示快捷键" },
];

export function KeyboardCheatsheet({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Inbox keyboard shortcuts"
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--ink)]/30 backdrop-blur-[2px]"
      />
      <div
        ref={cardRef}
        className={[
          "relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto",
          "rounded-[var(--radius-lg)] border border-[var(--paper-shadow)]",
          "bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)]",
          "gmc-cheatsheet-in",
        ].join(" ")}
      >
        <div className="px-6 pt-6 pb-4 border-b border-[var(--paper-shadow)]/70">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Keyboard · 快捷键
          </div>
          <h2 className="mt-2.5 font-display text-[22px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
            Inbox shortcuts
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--ink-mute)] leading-[1.55]">
            Fly through triage. Disabled while typing in any field.
          </p>
        </div>

        <ul className="px-6 py-4 divide-y divide-[var(--paper-shadow)]/40">
          {SHORTCUTS.map((s) => (
            <li
              key={s.en}
              className="grid grid-cols-[auto_1fr] items-center gap-4 py-2.5"
            >
              <span className="flex-none flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <span
                    key={`${k}-${i}`}
                    className="inline-flex items-center justify-center min-w-[26px] h-[24px] px-1.5 rounded-[6px] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] font-mono text-[var(--ink)] shadow-[0_1px_0_var(--paper-shadow)]"
                  >
                    {k}
                  </span>
                ))}
              </span>
              <span className="flex items-baseline gap-2 text-[12.5px] text-[var(--ink)]">
                <span className="truncate">{s.en}</span>
                <span className="text-[11px] text-[var(--ink-faint)] truncate">· {s.cn}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="px-6 pb-5 pt-1 flex items-center justify-between text-[11px] text-[var(--ink-faint)]">
          <span className="tracking-[0.04em]">
            Tip — focus a row first (mouse hover counts).
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[11px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30"
          >
            Close · 关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
