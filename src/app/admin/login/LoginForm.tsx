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

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
          Email
        </span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full px-4 py-3 bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
        />
      </label>

      <label className="block">
        <span className="text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
          Password
        </span>
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full px-4 py-3 bg-[var(--paper-warm)] border border-[var(--paper-shadow)] text-[15px] text-[var(--ink)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="border border-[var(--cinnabar)] bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-5 py-3 bg-[var(--ink)] text-[var(--paper-warm)] text-[13px] tracking-[0.2em] uppercase hover:bg-[var(--cinnabar)] focus-visible:shadow-[var(--shadow-focus)] active:translate-y-[1px] disabled:opacity-60 disabled:cursor-not-allowed transition-[background-color,transform,box-shadow] duration-[var(--dur-fast)]"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
