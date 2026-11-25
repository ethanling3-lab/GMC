"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ParticipantPicker, type ParticipantHit } from "@/components/admin/events/ParticipantPicker";
import { SEAT_STATUS_LABEL, type Seat } from "@/lib/seats/types";
import { CardShell } from "./CardShell";

// 名额 · Reward seats on a participant's page (migration 082, Super Admin).
// "Held" = seats this member owns (issued with their programme); each can
// be given to family / a business partner / a friend — never themselves.
// "Received" = seats others gave this person. Staff use a received seat on
// the person's registration from the event's enrollments page.

const btn =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-40 transition-[border-color,color,transform] duration-[var(--dur-fast)]";
const input =
  "h-9 w-full px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const label = "text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

const TONE: Record<Seat["status"], string> = {
  available: "text-[var(--ink-soft)] border-[var(--paper-shadow)]",
  assigned: "text-[var(--cinnabar-deep)] border-[var(--cinnabar)]/30",
  used: "text-[#3a6b3b] border-[#3a6b3b]/30",
  cancelled: "text-[var(--ink-faint)] border-[var(--paper-shadow)] line-through",
};

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
  if (!res.ok) throw new Error(j.detail ?? j.error ?? `Failed (${res.status})`);
}

export function RewardSeatsCard({
  participantId,
  participantName,
  held,
  received,
  courses,
}: {
  participantId: string;
  participantName: string;
  held: Seat[];
  received: Seat[];
  courses: Array<{ id: string; name_cn: string; name_en: string | null }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [issue, setIssue] = useState({ course_id: "", quantity: "1", note: "" });
  const [giving, setGiving] = useState<string | null>(null); // seat id
  const [pick, setPick] = useState<ParticipantHit | null>(null);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await fn() });
      router.refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const issueSeats = () =>
    run(async () => {
      const qty = Number(issue.quantity);
      await call(`/api/admin/participants/${participantId}/seats`, "POST", {
        course_id: issue.course_id,
        quantity: qty,
        note: issue.note.trim() || null,
      });
      const c = courses.find((x) => x.id === issue.course_id);
      setIssue({ course_id: "", quantity: "1", note: "" });
      return `✓ Issued ${qty} × ${c?.name_cn ?? "名额"} to ${participantName}.`;
    });

  const give = (seat: Seat) =>
    pick &&
    run(async () => {
      await call(`/api/admin/seats/${seat.id}`, "PATCH", { action: "assign", recipient_id: pick.id });
      const who = pick.name_cn || pick.name_en || "them";
      setGiving(null);
      setPick(null);
      return `✓ Gave ${seat.course.name_cn} to ${who}.`;
    });

  const takeBack = (seat: Seat) =>
    run(async () => {
      await call(`/api/admin/seats/${seat.id}`, "PATCH", { action: "unassign" });
      return `✓ Took back ${seat.course.name_cn}.`;
    });

  const cancel = (seat: Seat) => {
    const reason = window.prompt(`Cancel this ${seat.course.name_cn} 名额? It can't be used afterwards.\nReason (kept in the audit log):`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setNotice({ ok: false, text: "Give a short reason (3+ characters)." });
      return;
    }
    void run(async () => {
      await call(`/api/admin/seats/${seat.id}`, "PATCH", { action: "cancel", reason: reason.trim() });
      return `✓ Cancelled the ${seat.course.name_cn} 名额.`;
    });
  };

  const usable = held.filter((s) => s.status !== "cancelled");
  const counts = {
    available: held.filter((s) => s.status === "available").length,
    assigned: held.filter((s) => s.status === "assigned").length,
    used: held.filter((s) => s.status === "used").length,
  };

  return (
    <CardShell eyebrow="Reward seats" eyebrowZh="名额" title="Seats held and received" editing={false} editable={false}>
      <p className="mt-3 text-[12.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[70ch]">
        A 名额 is for one course. The holder gives it to family, a business partner or a friend (never themselves); on
        that person&apos;s registration the course fee is waived and they pay the 会务费 only.
      </p>
      {notice ? (
        <p className={`mt-3 text-[12.5px] ${notice.ok ? "text-[var(--ink-soft)]" : "text-[var(--cinnabar-deep)]"}`}>{notice.text}</p>
      ) : null}

      {/* Held */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-[13.5px] font-medium text-[var(--ink)]">Held · 持有</h3>
          {usable.length > 0 ? (
            <span className="text-[11.5px] text-[var(--ink-mute)]">
              {counts.available} not given · {counts.assigned} given · {counts.used} used
            </span>
          ) : null}
        </div>
        {held.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--ink-faint)] italic">No 名额 issued to {participantName}.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {held.map((s) => (
              <li key={s.id} className="py-2.5 border-t first:border-t-0 border-[var(--paper-shadow)]/70">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <span className="text-[var(--ink)]">{s.course.name_cn}</span>
                    <span className={`ml-2 inline-flex rounded-full border px-2 py-px text-[10.5px] ${TONE[s.status]}`}>
                      {SEAT_STATUS_LABEL[s.status].cn} · {SEAT_STATUS_LABEL[s.status].en}
                    </span>
                    {s.recipient ? (
                      <span className="ml-2 text-[12px] text-[var(--ink-soft)]">
                        → <Link href={`/admin/participants/${s.recipient.id}`} className="underline underline-offset-2 rounded-sm focus-visible:shadow-[var(--shadow-focus)]">{s.recipient.name}</Link>
                        {s.recipient.region_id ? <span className="ml-1 font-mono text-[11px] text-[var(--ink-faint)]">{s.recipient.region_id}</span> : null}
                      </span>
                    ) : null}
                    {s.used_on ? (
                      <span className="ml-2 text-[12px] text-[var(--ink-mute)]">
                        used on{" "}
                        <Link href={`/admin/events/${s.used_on.event_id}/enrollments`} className="underline underline-offset-2 rounded-sm focus-visible:shadow-[var(--shadow-focus)]">
                          {s.used_on.title}
                          {s.used_on.start_date ? ` ${s.used_on.start_date}` : ""}
                        </Link>
                      </span>
                    ) : null}
                    {s.note ? <div className="mt-0.5 text-[11.5px] text-[var(--ink-faint)]">{s.note}</div> : null}
                    {s.status === "cancelled" && s.cancel_reason ? (
                      <div className="mt-0.5 text-[11.5px] text-[var(--ink-faint)]">Cancelled: {s.cancel_reason}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    {s.status === "available" ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => { setGiving(s.id); setPick(null); }}>
                        Give to…
                      </button>
                    ) : null}
                    {s.status === "assigned" ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => takeBack(s)}>
                        Take back
                      </button>
                    ) : null}
                    {s.status === "available" || s.status === "assigned" ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => cancel(s)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
                {giving === s.id ? (
                  <div className="mt-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-3">
                    <div className={label}>Give this {s.course.name_cn} 名额 to · 赠送给</div>
                    <div className="mt-2">
                      <ParticipantPicker value={pick} onPick={setPick} />
                    </div>
                    {pick && pick.id === participantId ? (
                      <p className="mt-2 text-[12px] text-[var(--cinnabar-deep)]">
                        A 名额 can&apos;t go to its own holder — pick family, a business partner or a friend.
                      </p>
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <button type="button" className={btn} disabled={busy} onClick={() => { setGiving(null); setPick(null); }}>
                        Close
                      </button>
                      <button
                        type="button"
                        className={btn}
                        disabled={busy || !pick || pick.id === participantId}
                        onClick={() => give(s)}
                      >
                        Give 名额
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Issue */}
        <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-3.5">
          <div className={label}>Issue 名额 · 发放</div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_90px] gap-2">
            <select className={input} value={issue.course_id} onChange={(e) => setIssue((x) => ({ ...x, course_id: e.target.value }))}>
              <option value="">— Course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_cn}
                  {c.name_en ? ` · ${c.name_en}` : ""}
                </option>
              ))}
            </select>
            <input
              className={`${input} tabular-nums`}
              type="number"
              min={1}
              max={20}
              value={issue.quantity}
              onChange={(e) => setIssue((x) => ({ ...x, quantity: e.target.value }))}
              aria-label="How many"
            />
            <input
              className={`${input} sm:col-span-2`}
              value={issue.note}
              placeholder="Note, e.g. 荣贵 2026 purchase · 全款"
              onChange={(e) => setIssue((x) => ({ ...x, note: e.target.value }))}
            />
          </div>
          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              className={btn}
              disabled={busy || !issue.course_id || !(Number(issue.quantity) >= 1 && Number(issue.quantity) <= 20)}
              onClick={issueSeats}
            >
              Issue
            </button>
          </div>
        </div>
      </div>

      {/* Received */}
      <div className="mt-6">
        <h3 className="text-[13.5px] font-medium text-[var(--ink)]">Received · 获赠</h3>
        {received.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--ink-faint)] italic">No 名额 given to {participantName}.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {received.map((s) => (
              <li key={s.id} className="py-2.5 border-t first:border-t-0 border-[var(--paper-shadow)]/70 text-[13px]">
                <span className="text-[var(--ink)]">{s.course.name_cn}</span>
                <span className={`ml-2 inline-flex rounded-full border px-2 py-px text-[10.5px] ${TONE[s.status]}`}>
                  {SEAT_STATUS_LABEL[s.status].cn} · {SEAT_STATUS_LABEL[s.status].en}
                </span>
                <span className="ml-2 text-[12px] text-[var(--ink-soft)]">
                  from{" "}
                  <Link href={`/admin/participants/${s.holder.id}`} className="underline underline-offset-2 rounded-sm focus-visible:shadow-[var(--shadow-focus)]">
                    {s.holder.name}
                  </Link>
                </span>
                {s.used_on ? (
                  <span className="ml-2 text-[12px] text-[var(--ink-mute)]">used on {s.used_on.title}</span>
                ) : s.status === "assigned" ? (
                  <span className="ml-2 text-[12px] text-[var(--ink-mute)]">
                    — use it from the event&apos;s Enrollments page when they register for {s.course.name_cn}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CardShell>
  );
}
