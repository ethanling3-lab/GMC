import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireParticipant } from "@/lib/participant-guard";
import {
  isEligibleVolunteer,
  loadRecentRecruits,
  type RecentRecruit,
} from "@/lib/participant-recruit";
import { RecruitRowActions } from "@/components/portal/recruit/RecruitRowActions";

export const metadata: Metadata = { title: "Recruit · 感召 — GMC" };
export const dynamic = "force-dynamic";

export default async function MeRecruitPage() {
  const participant = await requireParticipant();
  const eligible = await isEligibleVolunteer(participant.id);
  if (!eligible) {
    // Non-old-students don't see Recruit. Soft redirect to dashboard.
    redirect("/me?notice=recruit_not_eligible");
  }

  const recruits = await loadRecentRecruits(participant.id);

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        — Recruit · 感召
      </div>
      <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Help your friends join.
      </h1>
      <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
        Tap below to add a new student. Their info, an event, and payment —
        all in one quick form.
      </p>

      {/* Sticky primary CTA */}
      <div className="mt-6">
        <Link
          href="/me/recruit/new"
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 h-14 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[14px] tracking-[0.04em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] transition-colors"
          style={{ color: "var(--paper-warm)" }}
        >
          + Add a new student · 感召新学员
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Your recent recruits · 最近感召
        </h2>
        <div className="mt-3 space-y-2.5">
          {recruits.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">
              No recruits yet. Your first one will appear here.
            </p>
          ) : (
            recruits.map((r) => <RecruitRow key={r.enrollment_id} r={r} />)
          )}
        </div>
      </section>
    </div>
  );
}

function statusPill(r: RecentRecruit): { en: string; cn: string; tone: string } {
  if (r.payment_status === "paid" || r.status === "paid") {
    return {
      en: "Paid",
      cn: "已付款",
      tone: "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]",
    };
  }
  if (r.status === "approved") {
    return {
      en: "Approved",
      cn: "已通过",
      tone: "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]",
    };
  }
  if (r.status === "rejected" || r.status === "cancelled") {
    return {
      en: r.status,
      cn: r.status === "rejected" ? "已拒绝" : "已取消",
      tone: "border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] text-[var(--ink-mute)]",
    };
  }
  return {
    en: "Awaiting payment",
    cn: "等付款",
    tone: "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--ink-soft)]",
  };
}

function RecruitRow({ r }: { r: RecentRecruit }) {
  const name = r.lead?.name_cn ?? r.lead?.name_en ?? "—";
  const eventTitle = r.event?.title_cn ?? r.event?.title_en ?? "—";
  const pill = statusPill(r);
  const showResend =
    r.payment_status !== "paid" &&
    r.status !== "paid" &&
    r.status !== "rejected" &&
    r.status !== "cancelled";
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] text-[var(--ink)] truncate">{name}</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--ink-mute)] truncate">{eventTitle}</div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 h-[22px] rounded-[var(--radius-pill)] border ${pill.tone} text-[10.5px] tracking-[0.14em] uppercase`}
        >
          <span className="font-medium">{pill.en}</span>
          <span className="text-[var(--ink-faint)]">·</span>
          <span>{pill.cn}</span>
        </span>
      </div>
      {showResend ? (
        <RecruitRowActions
          enrollmentId={r.enrollment_id}
          phone={r.lead?.phone ?? null}
        />
      ) : null}
    </article>
  );
}
