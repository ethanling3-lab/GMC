import type { Metadata } from "next";
import { requireParticipant } from "@/lib/participant-guard";
import { childrenOf } from "@/lib/participants/children";
import { FamilyClient } from "./FamilyClient";

export const metadata: Metadata = { title: "My family · 我的家人 — GMC" };
export const dynamic = "force-dynamic";

// /me/family — a parent's children (migration 084). Children have no login
// of their own; the parent registers them for events and gets their messages.
export default async function MeFamilyPage() {
  const me = await requireParticipant();
  const children = await childrenOf(me.id);
  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">— Family · 家人</div>
      <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
        Your children.
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        Add your children here, then tick them under &ldquo;Who is attending?&rdquo; when you register for an event.
        Messages about their registrations come to you. · 在此添加子女，报名活动时勾选即可；相关通知会发送给您。
      </p>
      <FamilyClient initial={children} />
    </div>
  );
}
