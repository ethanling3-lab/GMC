"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type Props = {
  redirectTo: string;
  // When true, after the password is set we also POST to /api/auth/participant/claim-complete
  // to link the participants.auth_user_id. Used by the /auth/callback?claim=1 flow.
  linkAfter?: boolean;
};

export function SetPasswordForm({ redirectTo, linkAfter }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(
          updErr.message?.toLowerCase().includes("session")
            ? "Your link has expired. Request a new one."
            : updErr.message || "Could not set password.",
        );
        setSubmitting(false);
        return;
      }

      // For the claim flow: link the participants.auth_user_id after the
      // password is set. The claim API uses service-role + lower(email).
      if (linkAfter) {
        const res = await fetch("/api/auth/participant/claim-complete", {
          method: "POST",
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          // Conflict = same email matches multiple participants — admin fix.
          if (json?.error === "conflict") {
            setError(
              "We found more than one student record for this email. An admin needs to merge them — please contact support.",
            );
            setSubmitting(false);
            return;
          }
          if (json?.error === "no_match") {
            setError(
              "We couldn't find a student record matching your email. Please contact support.",
            );
            setSubmitting(false);
            return;
          }
        }
      }

      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error.";
      setError(msg);
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
          New password · 新密码
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
          Confirm password · 确认密码
        </span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
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
        disabled={submitting}
        className="w-full h-12 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium tracking-[0.04em]
                   hover:bg-[var(--cinnabar-deep)] hover:-translate-y-[1px]
                   disabled:opacity-60 disabled:cursor-not-allowed
                   transition-[background-color,transform] duration-[var(--dur-base)]"
        style={{ color: "var(--paper-warm)" }}
      >
        {submitting ? "Saving…" : "Set password · 设置密码"}
      </button>
    </form>
  );
}
