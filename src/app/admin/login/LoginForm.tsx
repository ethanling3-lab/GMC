"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { nextPath: string };

export function LoginForm({ nextPath }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json?.error === "not_admin"
            ? "This account is not registered as an admin."
            : json?.error === "invalid_credentials"
              ? "Email or password is incorrect."
              : "Could not sign in. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      const safeNext = nextPath && nextPath.startsWith("/admin") ? nextPath : "/admin";
      router.replace(safeNext);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-2 w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--paper-warm)] " +
    "border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] " +
    "placeholder:text-[var(--ink-faint)] " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_2px_rgba(11,41,84,0.04)] " +
    "outline-none " +
    "hover:border-[var(--ink-faint)] " +
    "focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_4px_rgba(37,99,235,0.14),inset_0_1px_0_rgba(255,255,255,0.5)] " +
    "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <label className="block">
        <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
          Email
        </span>
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="you@gmcglobal.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
            Password
          </span>
          <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
            6+ characters
          </span>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={submitting}
        className="group w-full h-12 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.04em]
                   shadow-[0_6px_20px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]
                   hover:bg-[var(--cinnabar-deep)] hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.22)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   active:translate-y-0
                   disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
                   transition-[background-color,transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                   inline-flex items-center justify-center gap-3"
      >
        {submitting ? "Signing in…" : "Sign in"}
        {!submitting ? (
          <span
            aria-hidden="true"
            className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
          />
        ) : null}
      </button>
    </form>
  );
}
