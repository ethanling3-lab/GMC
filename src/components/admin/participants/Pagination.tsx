"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Props = {
  page: number;
  pageSize: number;
  total: number;
};

export function Pagination({ page, pageSize, total }: Props) {
  const sp = useSearchParams();
  const pathname = usePathname() ?? "/admin/participants";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function hrefFor(p: number): string {
    const next = new URLSearchParams(sp.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-between gap-4 flex-wrap"
    >
      <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing{" "}
            <span className="text-[var(--ink)] font-medium tabular-nums">
              {from.toLocaleString()}–{to.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="text-[var(--ink)] font-medium tabular-nums">
              {total.toLocaleString()}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <PageButton href={hrefFor(page - 1)} disabled={prevDisabled} direction="prev">
          Prev
        </PageButton>
        <span className="px-3 text-[12px] tracking-[0.06em] text-[var(--ink-mute)] tabular-nums">
          <span className="text-[var(--ink)] font-medium">{page}</span>
          <span className="mx-1 text-[var(--ink-faint)]">/</span>
          <span>{totalPages}</span>
        </span>
        <PageButton href={hrefFor(page + 1)} disabled={nextDisabled} direction="next">
          Next
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  href,
  disabled,
  direction,
  children,
}: {
  href: string;
  disabled: boolean;
  direction: "prev" | "next";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-pill)] border text-[12px] tracking-[0.04em] transition-[background-color,color,border-color] duration-[var(--dur-fast)]";

  const arrow = (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: direction === "next" ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <path d="M6 2L3 5l3 3" />
    </svg>
  );

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-faint)] cursor-not-allowed select-none`}
      >
        {direction === "prev" ? arrow : null}
        {children}
        {direction === "next" ? arrow : null}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/25 focus-visible:shadow-[var(--shadow-focus)]`}
    >
      {direction === "prev" ? arrow : null}
      {children}
      {direction === "next" ? arrow : null}
    </Link>
  );
}
