"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FOLLOWUP_DAY_OPTIONS, type WhatsAppAutomations } from "@/lib/whatsapp/automations-types";
import { Row, SaveNote, Switch, fieldClass, rowShell, setupBtn } from "./setup-ui";

export function FollowUpCard({
  settings,
  canEdit,
}: {
  settings: WhatsAppAutomations;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings.followup_enabled);
  const [days, setDays] = useState(settings.followup_after_days);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = enabled !== settings.followup_enabled || days !== settings.followup_after_days;

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/whatsapp/followup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, after_days: days }),
      });
      if (!res.ok) throw new Error();
      setNote({ ok: true, text: "Saved · 已保存" });
      startTransition(() => router.refresh());
    } catch {
      setNote({ ok: false, text: "Couldn't save. Check your connection and try again · 保存失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={rowShell}>
      <Row
        title="Set follow-up message · 跟进消息"
        detail={
          settings.followup_enabled
            ? `On. Approved but unpaid people get one reminder after ${settings.followup_after_days} ${settings.followup_after_days === 1 ? "day" : "days"}.`
            : "Off. Remind approved people who haven't paid yet."
        }
      >
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={setupBtn}>
          {open ? "Close · 收起" : settings.followup_enabled ? "Edit · 编辑" : "Set up · 设置"}
        </button>
      </Row>

      {open ? (
        <div className="border-t border-[var(--paper-shadow)] px-5 py-5">
          <Switch
            label="Send payment reminder · 发送付款提醒"
            checked={enabled}
            disabled={!canEdit}
            onChange={setEnabled}
          />
          <label className="mt-5 block max-w-[260px] text-[12.5px] text-[var(--ink-soft)]">
            Send after approval · 批准后发送
            <select
              value={days}
              disabled={!canEdit}
              onChange={(e) => setDays(Number(e.target.value))}
              className={fieldClass}
            >
              {FOLLOWUP_DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? "day" : "days"} · {d} 天
                </option>
              ))}
            </select>
          </label>

          <ul className="mt-4 list-disc pl-5 space-y-1 text-[12.5px] leading-[1.6] text-[var(--ink-soft)]">
            <li>Each person gets one reminder, with their payment link. 每人只提醒一次，并附付款链接。</li>
            <li>Only people approved after you turn this on. 只提醒开启后获批准的人。</li>
            <li>Sent between 9am and 8pm Singapore time. 新加坡时间上午 9 点至晚上 8 点发送。</li>
            <li>Nobody who has paid, or whose event has passed. 已付款或活动已结束者不会收到。</li>
          </ul>

          {canEdit ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving || isPending}
                className={setupBtn}
              >
                {saving ? "Saving…" : "Save · 保存"}
              </button>
              <SaveNote note={note} />
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
