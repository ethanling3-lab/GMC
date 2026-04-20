"use client";

import { useState } from "react";

type Props = {
  token: string;
  locale: "zh" | "en";
  amountLabel: string;
};

export function HitPayCheckoutButton({ token, locale, amountLabel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/hitpay`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.error === "already_paid") {
          throw new Error(
            locale === "zh"
              ? "您的报名已显示为已付款，无需再次付款。"
              : "This registration is already marked as paid.",
          );
        }
        if (payload?.error === "method_not_enabled") {
          throw new Error(
            locale === "zh"
              ? "此次活动暂未启用 HitPay 付款方式。"
              : "HitPay isn't enabled for this event yet.",
          );
        }
        if (payload?.error === "invalid_amount") {
          throw new Error(
            locale === "zh"
              ? "此次活动金额未设置，请联系 GMC 客服。"
              : "This event has no price set yet — please contact GMC.",
          );
        }
        throw new Error(
          payload?.detail ?? payload?.error ?? `Checkout failed (${res.status})`,
        );
      }
      const url: string | undefined = payload?.url;
      if (!url) throw new Error("No checkout URL returned");
      // Hand off the browser to HitPay's hosted page. The participant returns
      // to /pay/<token>?paid=1 after completion; the webhook is the source of
      // truth and flips the row to paid independently.
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={busy}
        className="inline-flex items-center gap-2 h-12 px-6 rounded-[var(--radius-pill)]
                   bg-[var(--cinnabar)] text-[var(--paper-warm)]
                   text-[14px] tracking-[0.02em] font-medium
                   hover:bg-[var(--cinnabar-deep)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   shadow-[0_4px_14px_rgba(192,56,47,0.28)]
                   transition-[background-color] duration-[var(--dur-fast)]
                   disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {busy ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
            <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="4" width="11" height="8" rx="1.2" />
            <path d="M2.5 6.5h11" />
          </svg>
        )}
        {locale === "zh"
          ? `通过 HitPay 付款 · ${amountLabel}`
          : `Pay ${amountLabel} with HitPay`}
      </button>
      {error ? (
        <div role="alert" className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}
      <p className="mt-3 text-[11.5px] leading-[1.7] text-[var(--ink-faint)] max-w-[44ch]">
        {locale === "zh"
          ? "您将被引导至 HitPay 安全付款页面。完成后会自动返回本页，并在到账后收到收据邮件。"
          : "You'll be taken to HitPay's secure checkout. We'll bring you back here after, and email a receipt once the funds clear."}
      </p>
    </div>
  );
}
