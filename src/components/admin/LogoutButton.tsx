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
      className="px-2 py-1 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-60 transition-colors duration-[var(--dur-fast)]"
    >
      {busy ? "…" : "Out"}
    </button>
  );
}
