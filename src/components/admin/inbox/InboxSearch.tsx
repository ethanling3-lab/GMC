"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

// Compact inline search for the inbox toolbar. Pushes the term into the URL
// as `?q=…` so bookmarking / sharing works; the server page reads the same.

export function InboxSearch({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQ);
  const [isPending, startTransition] = useTransition();

  function apply(next: string) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next.trim()) sp.set("q", next.trim());
    else sp.delete("q");
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/admin/inbox?${qs}` : "/admin/inbox");
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply(value);
      }}
      className="flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)]
                 border border-[var(--paper-shadow)] bg-[var(--paper)]
                 focus-within:border-[var(--cinnabar)]/40
                 focus-within:shadow-[var(--shadow-focus)]
                 transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="text-[var(--ink-faint)]"
        aria-hidden="true"
      >
        <circle cx="5" cy="5" r="3" />
        <path d="M7.5 7.5L10 10" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search name, region ID, phone…"
        className="w-48 bg-transparent outline-none text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            apply("");
          }}
          className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
        >
          Clear
        </button>
      ) : null}
      {isPending ? (
        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">…</span>
      ) : null}
    </form>
  );
}
