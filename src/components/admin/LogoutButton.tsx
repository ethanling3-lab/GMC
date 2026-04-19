"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
    } catch {
      /* fall through to redirect */
    }
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      className="inline-flex items-center justify-center w-8 h-8 rounded-full
                 text-[var(--ink-mute)]
                 hover:text-[var(--cinnabar)] hover:bg-[var(--cinnabar-wash)]
                 focus-visible:shadow-[var(--shadow-focus)]
                 disabled:opacity-60
                 transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
    >
      {busy ? (
        <span className="text-[10px] tracking-[0.14em]">…</span>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5.5 2.5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2.5" />
          <path d="M8.5 4.5L11.5 7L8.5 9.5" />
          <path d="M11.5 7h-6" />
        </svg>
      )}
    </button>
  );
}
