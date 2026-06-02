"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { nextPath: string };

type Mode = "sign_in" | "claim";

export function LoginForm({ nextPath }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === "sign_in") {
        const res = await fetch("/api/auth/participant/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            json?.error === "not_linked"
              ? "This account isn't linked yet. Switch to Set up account."
              : json?.error === "invalid_credentials"
                ? "Email or password is incorrect."
                : "Could not sign in. Please try again.",
          );
          setSubmitting(false);
          return;
        }
        const safe = nextPath && (nextPath.startsWith("/me") || nextPath === "/me") ? nextPath : "/me";
        router.replace(safe);
        router.refresh();
      } else {
        const res = await fetch("/api/auth/participant/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          setError("Could not send setup link. Please try again.");
          setSubmitting(false);
          return;
        }
        setInfo(
          "If your email is in our system, you'll get a setup link shortly. Check your inbox (and spam folder).",
        );
        setSubmitting(false);
      }
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
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]">
        {(
          [
            { id: "sign_in", label_en: "Sign in", label_cn: "登录" },
            { id: "claim", label_en: "Set up account", label_cn: "设置账户" },
          ] as Array<{ id: Mode; label_en: string; label_cn: string }>
        ).map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                setError(null);
                setInfo(null);
              }}
              className={`flex-1 inline-flex flex-col items-center justify-center px-3 py-2 rounded-[var(--radius-pill)] text-[12px] tracking-[0.06em] transition-colors ${
                active
                  ? "bg-[var(--paper-warm)] text-[var(--ink)] shadow-[0_1px_2px_rgba(11,41,84,0.05)]"
                  : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
              }`}
            >
              <span className="font-medium">{m.label_en}</span>
              <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mt-0.5">
                {m.label_cn}
              </span>
            </button>
          );
        })}
      </div>

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

      {mode === "sign_in" ? (
        <label className="block">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
              Password · 密码
            </span>
            <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              8+ characters
            </span>
          </div>
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </label>
      ) : (
        <p className="text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
          We&apos;ll send a setup link to your email. Click it to set a password
          and link your existing student record. <br />
          <span className="text-[var(--ink-faint)]">
            我们会发送设置链接到您的邮箱。点击后设置密码并绑定您的学员记录。
          </span>
        </p>
      )}

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
                   shadow-[0_6px_20px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]
                   hover:bg-[var(--cinnabar-deep)] hover:-translate-y-[1px]
                   focus-visible:shadow-[var(--shadow-focus)]
                   active:translate-y-0
                   disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0
                   transition-[background-color,transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]"
        style={{ color: "var(--paper-warm)" }}
      >
        {submitting
          ? mode === "sign_in"
            ? "Signing in…"
            : "Sending link…"
          : mode === "sign_in"
            ? "Sign in · 登录"
            : "Send setup link · 发送设置链接"}
      </button>
    </form>
  );
}
