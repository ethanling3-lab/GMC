"use client";

import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/participant/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError("Could not send reset link. Please try again.");
        setSubmitting(false);
        return;
      }
      setInfo(
        "If your email is in our system, you'll get a reset link shortly. Check your inbox (and spam folder).",
      );
      setSubmitting(false);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-2 w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--paper-warm)] " +
    "border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] " +
    "placeholder:text-[var(--ink-faint)] outline-none " +
    "focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_4px_rgba(37,99,235,0.14)] " +
    "transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
          Email · 邮箱
        </span>
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldClass}
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}
      {info ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-deep)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--ink-soft)]"
        >
          {info}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.04em]
                   hover:bg-[var(--cinnabar-deep)] hover:-translate-y-[1px]
                   disabled:opacity-60 disabled:cursor-not-allowed
                   transition-[background-color,transform] duration-[var(--dur-base)]"
        style={{ color: "var(--paper-warm)" }}
      >
        {submitting ? "Sending…" : "Send reset link · 发送重置链接"}
      </button>
    </form>
  );
}
