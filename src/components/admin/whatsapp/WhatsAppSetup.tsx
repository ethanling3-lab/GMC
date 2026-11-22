"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WELCOME_MAX_CHARS, type WhatsAppAutomations } from "@/lib/whatsapp/automations-types";

const rowShell =
  "rounded-[14px] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]";

const setupBtn =
  "shrink-0 inline-flex items-center justify-center h-10 min-w-[116px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[13px] font-medium text-[var(--paper-warm)] whitespace-nowrap hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";

function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-[200px] flex-1">
        <h2 className="text-[15.5px] font-medium leading-snug text-[var(--ink)]">{title}</h2>
        <p className="mt-0.5 text-[12.5px] leading-[1.55] text-[var(--ink-mute)]">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function ComingSoon() {
  return (
    <span className="shrink-0 inline-flex items-center justify-center h-10 min-w-[116px] px-5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[13px] text-[var(--ink-mute)] whitespace-nowrap">
      Coming soon · 即将推出
    </span>
  );
}

export function WhatsAppSetup({
  settings,
  canEdit,
}: {
  settings: WhatsAppAutomations;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className={rowShell}>
        <Row
          title="Send a message broadcast · 群发消息"
          detail="Official notices to event participants. Hold marketing until subscribers are added."
        >
          <Link href="/admin/broadcasts" className={setupBtn} style={{ color: "var(--paper-warm)" }}>
            Set up · 设置
          </Link>
        </Row>
      </div>
      <div className={rowShell}>
        <Row
          title="Automate your FAQs · 自动回答常见问题"
          detail="Add your answers once, and the AI uses them to reply."
        >
          <ComingSoon />
        </Row>
      </div>
      <WelcomeCard settings={settings} canEdit={canEdit} />
      <div className={rowShell}>
        <Row
          title="Set follow-up message · 跟进消息"
          detail="Remind people automatically after a set time."
        >
          <ComingSoon />
        </Row>
      </div>
    </div>
  );
}

function WelcomeCard({ settings, canEdit }: { settings: WhatsAppAutomations; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings.welcome_enabled);
  const [en, setEn] = useState(settings.welcome_en);
  const [zh, setZh] = useState(settings.welcome_zh);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    enabled !== settings.welcome_enabled || en !== settings.welcome_en || zh !== settings.welcome_zh;
  const valid =
    en.trim().length > 0 &&
    zh.trim().length > 0 &&
    en.length <= WELCOME_MAX_CHARS &&
    zh.length <= WELCOME_MAX_CHARS;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/whatsapp/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcome_enabled: enabled, welcome_en: en, welcome_zh: zh }),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: "Couldn't save. Check your connection and try again · 保存失败" });
        return;
      }
      setMessage({ ok: true, text: "Saved · 已保存" });
      startTransition(() => router.refresh());
    } catch {
      setMessage({ ok: false, text: "Couldn't save. Check your connection and try again · 保存失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={rowShell}>
      <Row
        title="Set up a welcome message · 欢迎语"
        detail={
          settings.welcome_enabled
            ? "On. New contacts get this after their first message."
            : "Off. Greet new contacts automatically after their first message."
        }
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={setupBtn}
        >
          {open ? "Close · 收起" : settings.welcome_enabled ? "Edit · 编辑" : "Set up · 设置"}
        </button>
      </Row>

      {open ? (
        <div className="border-t border-[var(--paper-shadow)] px-5 py-5">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-[14px] font-medium text-[var(--ink)]">
              Send welcome message · 发送欢迎语
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!canEdit}
              onClick={() => setEnabled((v) => !v)}
              className={`relative shrink-0 w-11 h-6 rounded-full focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-[background-color] duration-[var(--dur-fast)] ${
                enabled ? "bg-[var(--cinnabar)]" : "bg-[var(--paper-shadow)]"
              }`}
            >
              <span
                className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-[var(--paper)] transition-transform duration-[var(--dur-fast)] ${
                  enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <MessageField label="English" value={en} onChange={setEn} disabled={!canEdit} />
            <MessageField label="中文" value={zh} onChange={setZh} disabled={!canEdit} />
          </div>

          <p className="mt-3 text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
            Sent once, in the language the customer writes in. If they only say hello, the AI waits
            for their question.
          </p>

          {canEdit ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || !valid || saving || isPending}
                className={setupBtn}
              >
                {saving ? "Saving…" : "Save · 保存"}
              </button>
              {message ? (
                <span
                  role={message.ok ? "status" : "alert"}
                  className={`text-[12.5px] ${message.ok ? "text-[var(--ink-soft)]" : "text-[#B91C1C]"}`}
                >
                  {message.text}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-[12.5px] text-[var(--ink-mute)]">
              Only super admins and regional leads can change this.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MessageField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const over = value.length > WELCOME_MAX_CHARS;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-[12.5px] text-[var(--ink-soft)]">
        {label}
        <span className={`tabular-nums text-[11.5px] ${over ? "text-[#B91C1C]" : "text-[var(--ink-faint)]"}`}>
          {value.length} / {WELCOME_MAX_CHARS}
        </span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={7}
        className="mt-1.5 w-full resize-y rounded-[10px] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3.5 py-3 text-[14px] leading-[1.6] text-[var(--ink)] focus-visible:outline-none focus-visible:border-[var(--cinnabar)]/50 focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-70"
      />
    </label>
  );
}
