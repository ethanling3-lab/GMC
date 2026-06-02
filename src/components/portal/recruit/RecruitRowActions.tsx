"use client";

import { useState } from "react";

// Per-row actions on /me/recruit: Resend payment link (WhatsApp + email)
// and tel: call link. Fires the resend-link API to mint a fresh payment
// token + WA deeplink, then either opens whatsapp:// or copies the URL.

export function RecruitRowActions({
  enrollmentId,
  phone,
}: {
  enrollmentId: string;
  phone: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/me/recruit/leads/${encodeURIComponent(enrollmentId)}/resend-link`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json?.error === "already_paid"
            ? "Already paid · 已付款"
            : json?.error === "forbidden"
              ? "Not your lead"
              : "Could not generate link",
        );
        setBusy(false);
        return;
      }
      if (json.wa_deeplink) {
        window.open(json.wa_deeplink, "_blank");
      } else if (json.payment_url) {
        try {
          await navigator.clipboard.writeText(json.payment_url);
          window.alert("Link copied · 链接已复制");
        } catch {
          window.prompt("Copy this link:", json.payment_url);
        }
      }
      setBusy(false);
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-[var(--paper-shadow)] flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 h-9 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[11.5px] tracking-[0.08em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
      >
        {busy ? "Generating…" : "Resend link · 重发链接"}
      </button>
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[11.5px] tracking-[0.08em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] transition-colors"
          style={{ color: "var(--ink-soft)" }}
        >
          Call · 拨打
        </a>
      ) : null}
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)] ml-1">{error}</span>
      ) : null}
    </div>
  );
}
