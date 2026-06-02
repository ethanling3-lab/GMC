import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireParticipant } from "@/lib/participant-guard";
import {
  isEligibleVolunteer,
  loadOpenEvents,
} from "@/lib/participant-recruit";
import { AddLeadForm } from "@/components/portal/recruit/AddLeadForm";

export const metadata: Metadata = { title: "Add a new student · 感召 — GMC" };
export const dynamic = "force-dynamic";

export default async function NewRecruitPage() {
  const participant = await requireParticipant();
  const eligible = await isEligibleVolunteer(participant.id);
  if (!eligible) redirect("/me?notice=recruit_not_eligible");

  const events = await loadOpenEvents();

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        — Recruit · 感召
      </div>
      <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Add a new student.
      </h1>
      <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
        Three quick fields, then take payment.
      </p>

      <div className="mt-8">
        <AddLeadForm
          events={events.map((e) => ({
            id: e.id,
            slug: e.slug,
            title_cn: e.title_cn,
            title_en: e.title_en,
            start_date: e.start_date,
            price: e.price,
          }))}
        />
      </div>
    </div>
  );
}
