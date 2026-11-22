"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETING_STATUS_LABEL,
  type MarketingStatus,
} from "@/lib/whatsapp/marketing-status";

// Whether this person gets marketing broadcasts. Staff change it only when the
// person has told them; WhatsApp replies and the registration form set it
// automatically.

export function MarketingStatusControl({
  participantId,
  status,
}: {
  participantId: string;
  status: MarketingStatus;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function change(next: string) {
    if (next === status) return;
    const label = MARKETING_STATUS_LABEL[next as MarketingStatus];
    const ok = window.confirm(
      next === "subscribed"
        ? "Only subscribe someone who has asked for GMC marketing messages. Continue?\n仅在对方同意接收推广消息时才可订阅。继续？"
        : `Mark this person as ${label.en}? They will stop getting marketing messages.\n标记为${label.cn}？对方将不再收到推广消息。`,
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/participants/${participantId}/marketing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError("Couldn't save. Try again · 保存失败");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Couldn't save. Try again · 保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          Marketing
        </span>
        <select
          value={status}
          disabled={saving || isPending}
          onChange={(e) => void change(e.target.value)}
          className="h-8 w-[148px] min-w-0 shrink rounded-[8px] border border-[var(--paper-shadow)] bg-[var(--paper)] px-2 text-[12px] text-[var(--ink)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-60"
        >
          {status === "not_asked" ? (
            <option value="not_asked" disabled>
              {MARKETING_STATUS_LABEL.not_asked.en} · {MARKETING_STATUS_LABEL.not_asked.cn}
            </option>
          ) : null}
          <option value="subscribed">
            {MARKETING_STATUS_LABEL.subscribed.en} · {MARKETING_STATUS_LABEL.subscribed.cn}
          </option>
          <option value="unsubscribed">
            {MARKETING_STATUS_LABEL.unsubscribed.en} · {MARKETING_STATUS_LABEL.unsubscribed.cn}
          </option>
        </select>
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-right text-[11.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
