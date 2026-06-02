"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type EventOption = {
  id: string;
  slug: string;
  title_cn: string | null;
  title_en: string | null;
  start_date: string | null;
  price: number | string | null;
};

// Mobile-first single-page form. Volunteer captures the bare minimum:
// event + name + phone + optional email. Three big-thumb CTAs at the
// bottom: Take payment now (primary), Send via WhatsApp, Send via email.

export function AddLeadForm({ events }: { events: EventOption[] }) {
  const router = useRouter();
  const [eventId, setEventId] = useState<string>(events[0]?.id ?? "");
  const [nameCn, setNameCn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    payment_url: string;
    wa_deeplink: string;
  }>(null);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  );

  function validate(): string | null {
    if (!selectedEvent) return "Pick an event · 选择活动";
    if (!nameCn.trim() && !nameEn.trim()) return "Add a name · 输入姓名";
    if (!phone.trim() || phone.replace(/\D/g, "").length < 6) return "Add a phone · 输入电话";
    return null;
  }

  async function submit(plan: "now" | "whatsapp_link" | "email_link") {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/recruit/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_slug: selectedEvent!.slug,
          name_cn: nameCn || undefined,
          name_en: nameEn || undefined,
          phone,
          email: email || undefined,
          payment_plan: plan,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json?.error === "already_enrolled"
            ? "Already enrolled · 已报名"
            : json?.error === "event_full"
              ? "Event is full · 名额已满"
              : json?.error === "event_not_open"
                ? "Event closed · 报名已截止"
                : json?.error === "not_eligible"
                  ? "Not eligible to recruit · 无资格"
                  : json?.detail || "Could not add",
        );
        setSubmitting(false);
        return;
      }

      if (plan === "now") {
        // Direct redirect to HitPay-backed /pay/<token>; volunteer hands phone to lead.
        window.location.href = json.payment_url;
        return;
      }
      if (plan === "whatsapp_link") {
        // Open WhatsApp deep link in new tab/window (mobile opens app).
        window.open(json.wa_deeplink, "_blank");
        setDone({ payment_url: json.payment_url, wa_deeplink: json.wa_deeplink });
        setSubmitting(false);
        return;
      }
      // email_link — fire-and-forget (no email-send wired in the route yet
      // since enrollment notification email flow runs via approve path).
      // For v1 just copy the link to clipboard for the volunteer to paste.
      try {
        await navigator.clipboard.writeText(json.payment_url);
      } catch {
        /* noop */
      }
      setDone({ payment_url: json.payment_url, wa_deeplink: json.wa_deeplink });
      setSubmitting(false);
    } catch {
      setError("Network error · 网络错误");
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-1.5 w-full px-3 h-11 rounded-[var(--radius-md)] bg-[var(--paper-warm)] " +
    "border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] " +
    "placeholder:text-[var(--ink-faint)] outline-none " +
    "focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] " +
    "transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  if (done) {
    return (
      <div className="space-y-5">
        <div className="rounded-[var(--radius-lg)] border border-[#5b9a5d]/30 bg-[#5b9a5d]/8 p-5">
          <div className="text-[10px] tracking-[0.22em] uppercase text-[#3a6b3b]">
            ✓ Added · 已添加
          </div>
          <p className="mt-2 text-[14px] text-[var(--ink)]">
            Payment link generated. Lead will complete payment when ready.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => router.push("/me/recruit")}
            className="inline-flex items-center justify-center px-5 h-11 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)]"
            style={{ color: "var(--paper-warm)" }}
          >
            Done · 完成
          </button>
          <button
            type="button"
            onClick={() => window.open(done.wa_deeplink, "_blank")}
            className="inline-flex items-center justify-center px-4 h-11 rounded-full border border-[var(--paper-shadow)] text-[13px] tracking-[0.04em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
          >
            Resend WhatsApp · 重发
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Event chip-picker */}
      <section>
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mb-2">
          1. Event · 活动
        </div>
        <div className="flex flex-wrap gap-2">
          {events.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">
              No open events at the moment.
            </p>
          ) : (
            events.map((e) => {
              const active = e.id === eventId;
              const title = e.title_cn ?? e.title_en ?? e.slug;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEventId(e.id)}
                  className={`inline-flex items-center gap-1.5 px-3 h-10 rounded-[var(--radius-pill)] border text-[12.5px] tracking-[0.04em] transition-colors ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                  }`}
                >
                  <span className="font-medium">{title}</span>
                  {e.start_date ? (
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums">
                      {e.start_date}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Step 2: Lead info */}
      <section>
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mb-2">
          2. Lead · 学员
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
              Name · 姓名 (中文)
            </span>
            <input
              type="text"
              value={nameCn}
              onChange={(e) => setNameCn(e.target.value)}
              placeholder="例：陈伟"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
              Name · Name (English)
            </span>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="e.g. Wei Chen"
              className={fieldClass}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
              Phone · 电话 (required)
            </span>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+65 9123 4567"
              className={fieldClass}
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
              Email · 邮箱 (optional)
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="optional"
              className={fieldClass}
              inputMode="email"
              autoComplete="email"
            />
          </label>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}

      {/* Step 3: Payment CTAs */}
      <section className="pt-3">
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mb-3">
          3. Close · 收单
        </div>

        {/* PRIMARY: full-width, thumb-sized */}
        <button
          type="button"
          onClick={() => submit("now")}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-5 h-14 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[15px] tracking-[0.04em] font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors"
          style={{ color: "var(--paper-warm)" }}
        >
          {submitting ? "Working…" : "Take payment now · 立即付款"}
        </button>

        {/* Secondary share actions */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => submit("whatsapp_link")}
            disabled={submitting}
            className="inline-flex items-center justify-center px-4 h-12 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[13px] tracking-[0.04em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
          >
            Send via WhatsApp
          </button>
          <button
            type="button"
            onClick={() => submit("email_link")}
            disabled={submitting}
            className="inline-flex items-center justify-center px-4 h-12 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[13px] tracking-[0.04em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
          >
            Copy link · 复制链接
          </button>
        </div>
      </section>
    </div>
  );
}
