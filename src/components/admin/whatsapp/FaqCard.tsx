"use client";

import { useState } from "react";
import {
  FAQ_ANSWER_MAX_CHARS,
  FAQ_QUESTION_MAX_CHARS,
  type WhatsAppFaq,
} from "@/lib/whatsapp/automations-types";
import { Row, SaveNote, Switch, fieldClass, quietBtn, rowShell, setupBtn } from "./setup-ui";

type Draft = { id: string | null; question: string; answer_en: string; answer_zh: string };

const EMPTY: Draft = { id: null, question: "", answer_en: "", answer_zh: "" };
const FAILED = "Couldn't save. Check your connection and try again · 保存失败";

export function FaqCard({
  initialEnabled,
  initialFaqs,
  canEdit,
}: {
  initialEnabled: boolean;
  initialFaqs: WhatsAppFaq[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [faqs, setFaqs] = useState(initialFaqs);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const draftValid =
    draft !== null &&
    draft.question.trim().length > 0 &&
    (draft.answer_en.trim().length > 0 || draft.answer_zh.trim().length > 0);

  async function toggle(next: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/whatsapp/faqs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
      setEnabled(next);
      setNote({ ok: true, text: next ? "On · 已开启" : "Off · 已关闭" });
    } catch {
      setNote({ ok: false, text: FAILED });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft || !draftValid) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(
        draft.id ? `/api/admin/whatsapp/faqs/${draft.id}` : "/api/admin/whatsapp/faqs",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: draft.question,
            answer_en: draft.answer_en.trim() || null,
            answer_zh: draft.answer_zh.trim() || null,
          }),
        },
      );
      if (!res.ok) throw new Error();
      const { faq } = (await res.json()) as { faq: WhatsAppFaq };
      setFaqs((list) =>
        draft.id ? list.map((f) => (f.id === faq.id ? faq : f)) : [...list, faq],
      );
      setDraft(null);
      setNote({ ok: true, text: "Saved · 已保存" });
    } catch {
      setNote({ ok: false, text: FAILED });
    } finally {
      setBusy(false);
    }
  }

  async function remove(faq: WhatsAppFaq) {
    if (!window.confirm(`Delete this answer?\n删除此问答？\n\n${faq.question}`)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/faqs/${faq.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setFaqs((list) => list.filter((f) => f.id !== faq.id));
      if (draft?.id === faq.id) setDraft(null);
      setNote({ ok: true, text: "Deleted · 已删除" });
    } catch {
      setNote({ ok: false, text: "Couldn't delete. Try again · 删除失败" });
    } finally {
      setBusy(false);
    }
  }

  const count = faqs.length;
  return (
    <div className={rowShell}>
      <Row
        title="Automate your FAQs · 自动回答常见问题"
        detail={
          enabled
            ? `On. The AI answers from ${count} saved ${count === 1 ? "answer" : "answers"}.`
            : "Off. Add your answers once, and the AI uses them to reply."
        }
      >
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={setupBtn}>
          {open ? "Close · 收起" : count > 0 ? "Edit · 编辑" : "Set up · 设置"}
        </button>
      </Row>

      {open ? (
        <div className="border-t border-[var(--paper-shadow)] px-5 py-5">
          <Switch
            label="Let the AI use these answers · 让 AI 使用这些回答"
            checked={enabled}
            disabled={!canEdit || busy || (!enabled && count === 0)}
            onChange={(next) => void toggle(next)}
          />
          {!enabled && count === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-[var(--ink-mute)]">
              Add at least one answer first. 请先添加至少一条回答。
            </p>
          ) : null}

          {count > 0 ? (
            <ul className="mt-5 divide-y divide-[var(--paper-shadow)] border-y border-[var(--paper-shadow)]">
              {faqs.map((f) => (
                <li key={f.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-[14px] font-medium text-[var(--ink)] break-words">{f.question}</div>
                    <p className="mt-0.5 text-[12.5px] leading-[1.55] text-[var(--ink-mute)] line-clamp-2 break-words">
                      {f.answer_en ?? f.answer_zh}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className={quietBtn}
                        onClick={() =>
                          setDraft({
                            id: f.id,
                            question: f.question,
                            answer_en: f.answer_en ?? "",
                            answer_zh: f.answer_zh ?? "",
                          })
                        }
                      >
                        Edit · 编辑
                      </button>
                      <button type="button" disabled={busy} className={quietBtn} onClick={() => void remove(f)}>
                        Delete · 删除
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {canEdit && draft ? (
            <div className="mt-5">
              <label className="block text-[12.5px] text-[var(--ink-soft)]">
                Question · 问题
                <input
                  value={draft.question}
                  maxLength={FAQ_QUESTION_MAX_CHARS}
                  onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                  placeholder="How do I pay? · 如何付款？"
                  className={fieldClass}
                />
              </label>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="block text-[12.5px] text-[var(--ink-soft)]">
                  Answer in English
                  <textarea
                    rows={5}
                    value={draft.answer_en}
                    maxLength={FAQ_ANSWER_MAX_CHARS}
                    onChange={(e) => setDraft({ ...draft, answer_en: e.target.value })}
                    className={`${fieldClass} resize-y`}
                  />
                </label>
                <label className="block text-[12.5px] text-[var(--ink-soft)]">
                  中文回答
                  <textarea
                    rows={5}
                    value={draft.answer_zh}
                    maxLength={FAQ_ANSWER_MAX_CHARS}
                    onChange={(e) => setDraft({ ...draft, answer_zh: e.target.value })}
                    className={`${fieldClass} resize-y`}
                  />
                </label>
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
                One language is enough. The AI translates it when needed. 填写一种语言即可。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!draftValid || busy}
                  onClick={() => void saveDraft()}
                  className={setupBtn}
                >
                  {busy ? "Saving…" : "Save answer · 保存"}
                </button>
                <button type="button" disabled={busy} onClick={() => setDraft(null)} className={quietBtn}>
                  Cancel · 取消
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canEdit && !draft ? (
              <button type="button" disabled={busy} onClick={() => setDraft(EMPTY)} className={quietBtn}>
                Add an answer · 添加回答
              </button>
            ) : null}
            <SaveNote note={note} />
          </div>

          {!canEdit ? (
            <p className="mt-4 text-[12.5px] text-[var(--ink-mute)]">
              Only super admins and regional leads can change this.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
