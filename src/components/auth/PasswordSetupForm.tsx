"use client";

import { useState } from "react";

const fieldClass =
  "mt-2 w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

export function PasswordSetupForm({
  token,
  type,
  endpoint,
  next,
}: {
  token: string;
  type: "invite" | "recovery";
  endpoint: string;
  /** Member page to land on afterwards (the server checks it). */
  next?: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters. 请至少输入 8 个字符。");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match. 两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, type, password, ...(next ? { next } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { detail?: string; redirect?: string };
      if (!res.ok) {
        setError(json.detail ?? "Couldn't set your password.");
        setBusy(false);
        return;
      }
      window.location.assign(json.redirect ?? "/");
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block text-[13px] text-[var(--ink-soft)]">
        New password · 新密码
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="block text-[13px] text-[var(--ink-soft)]">
        Confirm password · 确认密码
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
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
      <button
        type="submit"
        disabled={busy}
        className="w-full h-12 rounded-full bg-[var(--cinnabar)] text-[13px] font-medium hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.99] disabled:opacity-60 transition-[background-color,transform] duration-[var(--dur-base)]"
        style={{ color: "var(--paper-warm)" }}
      >
        {busy ? "Saving…" : "Set password and sign in · 设置密码并登录"}
      </button>
    </form>
  );
}
