import type { Metadata } from "next";

export const metadata: Metadata = { title: "Group · 小组 — GMC" };
export const dynamic = "force-dynamic";

export default function MeGroupPage() {
  return (
    <div>
      <div>
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Group · 小组
        </div>
        <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Your seating group.
        </h1>
      </div>

      <section className="mt-10 rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-8 md:p-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] mb-4">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7" />
            <path d="M10 6v4l3 2" />
          </svg>
        </div>
        <h2 className="font-display text-[20px] text-[var(--ink)]">Coming soon · 即将开放</h2>
        <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[42ch] mx-auto">
          Your group, table, and 组长 will appear here once the assignments are
          published before each event.
          <br />
          <span className="text-[var(--ink-mute)]">
            小组、桌号、组长 将于活动开始前公布。
          </span>
        </p>
      </section>
    </div>
  );
}
