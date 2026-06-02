import type { Metadata } from "next";
import { requireParticipant } from "@/lib/participant-guard";

export const metadata: Metadata = {
  title: "Your portal · 学员中心 — GMC",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MeHomePage() {
  const participant = await requireParticipant();
  const name = participant.name_cn ?? participant.name_en ?? "there";

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        — Welcome · 欢迎
      </div>
      <h1 className="mt-4 font-display text-[32px] md:text-[36px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Hi {name}.
      </h1>
      <p className="mt-3 text-[14.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
        Welcome to your GMC portal. Use the menu to manage your profile,
        enrollments, payments, flight info and class recordings.
      </p>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <DashCard
          eyebrow="Profile · 资料"
          title="Your details"
          body="Name, contact, language, region."
          href="/me/profile"
        />
        <DashCard
          eyebrow="Enrollments · 报名"
          title="Your classes"
          body="What you're signed up for."
          href="/me/enrollments"
        />
        <DashCard
          eyebrow="Payments · 付款"
          title="Outstanding"
          body="Complete any pending payments."
          href="/me/payments"
        />
        <DashCard
          eyebrow="Recordings · 录像"
          title="Class videos"
          body="Recordings you've been given access to."
          href="/me/recordings"
        />
        <DashCard
          eyebrow="Recruit · 感召"
          title="Add a new student"
          body="Sign up a friend; take payment on the spot."
          href="/me/recruit"
          highlight
        />
      </div>
    </div>
  );
}

function DashCard({
  eyebrow,
  title,
  body,
  href,
  highlight,
}: {
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  highlight?: boolean;
}) {
  const cls = highlight
    ? "border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]"
    : "border-[var(--paper-shadow)] bg-[var(--paper-warm)]";
  return (
    <a
      href={href}
      className={`block rounded-[var(--radius-lg)] border ${cls} p-5 hover:-translate-y-0.5 transition-transform shadow-[var(--shadow-paper-1)]`}
      style={{ color: "inherit" }}
    >
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
        {eyebrow}
      </div>
      <div className="mt-2 font-display text-[18px] leading-[1.2] text-[var(--ink)]">
        {title}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-[var(--ink-soft)]">{body}</p>
    </a>
  );
}
