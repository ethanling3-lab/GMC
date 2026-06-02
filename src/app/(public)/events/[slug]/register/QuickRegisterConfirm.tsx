"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  name_cn: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language_fluency: "en" | "cn" | "both" | null;
  region_id: string | null;
};

type Props = {
  eventSlug: string;
  eventTitle: string;
  eventTitleAlt: string;
  startDate: string | null;
  venue: string | null;
  price: number | string | null;
  profile: Profile;
};

export function QuickRegisterConfirm({
  eventSlug,
  eventTitle,
  eventTitleAlt,
  startDate,
  venue,
  price,
  profile,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/me/events/${encodeURIComponent(eventSlug)}/register`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json?.error === "already_enrolled"
            ? "You're already enrolled in this event."
            : json?.error === "event_full"
              ? "This event is full."
              : json?.error === "event_not_open"
                ? "This event is not currently open for registration."
                : json?.detail || "Could not complete registration. Please try again.";
        setError(err);
        setSubmitting(false);
        return;
      }
      if (json?.payment_token) {
        window.location.href = `/pay/${json.payment_token}`;
        return;
      }
      router.push(`/me/enrollments?just_registered=${eventSlug}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const langLabel =
    profile.language_fluency === "cn"
      ? "中文"
      : profile.language_fluency === "en"
        ? "English"
        : profile.language_fluency === "both"
          ? "Both · 双语"
          : null;

  return (
    <div className="mt-8 space-y-6">
      {/* Event summary card */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
          Event · 活动
        </div>
        <div className="mt-2 font-display text-[22px] leading-[1.2] text-[var(--ink)]">
          {eventTitle}
        </div>
        {eventTitleAlt && eventTitleAlt !== eventTitle ? (
          <div className="text-[13px] italic text-[var(--ink-soft)]">{eventTitleAlt}</div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] tracking-[0.06em] text-[var(--ink-soft)] tabular-nums">
          {startDate ? <span>📅 {startDate}</span> : null}
          {venue ? <span>📍 {venue}</span> : null}
          {price ? (
            <span>
              <span className="text-[var(--ink-faint)]">Price</span>{" "}
              <span className="text-[var(--ink)] font-medium">${price}</span>
            </span>
          ) : null}
        </div>
      </section>

      {/* Profile summary */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Your details · 您的资料
          </div>
          <a
            href="/me/profile"
            className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)]"
            style={{ color: "var(--ink-mute)" }}
          >
            Edit · 编辑 →
          </a>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Pair label="Name · 姓名" value={profile.name_cn ?? profile.name_en} />
          <Pair label="Region ID" value={profile.region_id} mono />
          <Pair label="Email · 邮箱" value={profile.email} />
          <Pair label="Phone · 电话" value={profile.phone} />
          <Pair label="Region · 区域" value={profile.region} />
          <Pair label="Language · 语言" value={langLabel} />
        </dl>
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}

      <div className="sticky bottom-4 z-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] p-4 flex items-center justify-between gap-4 flex-wrap">
        <a
          href="/events"
          className="text-[12px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)]"
          style={{ color: "var(--ink-mute)" }}
        >
          ← Cancel
        </a>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors"
          style={{ color: "var(--paper-warm)" }}
        >
          {submitting ? "Confirming…" : "Confirm & pay · 确认并付款"}
        </button>
      </div>
    </div>
  );
}

function Pair({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">{label}</dt>
      <dd className={`mt-0.5 text-[var(--ink)] ${mono ? "font-mono tabular-nums" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}
