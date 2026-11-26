"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ParticipantPicker, type ParticipantHit } from "@/components/admin/events/ParticipantPicker";
import { btn, primary, input, label, panel, callJson } from "@/components/admin/payments/ui";

// One recording on the event's Recordings page (Phase 4 replays · 回播).
// Members watch automatically while their programme is valid; the data
// team adds anyone else here, optionally until a last day.

export type GrantView = {
  grant_id: string;
  id: string;
  name: string;
  region_id: string | null;
  until: string | null;
  note: string | null;
  expired: boolean;
};

export type RecordingView = {
  id: string;
  title: string;
  mime_type: string | null;
  size: string;
  duration: string;
  members_auto: boolean;
  grants: GrantView[];
};

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function RecordingAccessCard({ eventId, rec, memberCount }: { eventId: string; rec: RecordingView; memberCount: number }) {
  const router = useRouter();
  const base = `/api/admin/events/${encodeURIComponent(eventId)}/recordings/${encodeURIComponent(rec.id)}`;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<ParticipantHit | null>(null);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggleAuto = () => run(() => callJson(base, "PATCH", { members_auto: !rec.members_auto }));
  const revoke = (g: GrantView) => run(() => callJson(`${base}/grants/${encodeURIComponent(g.grant_id)}`, "DELETE"));
  const add = async () => {
    if (!who) return;
    const ok = await run(() =>
      callJson(`${base}/grants`, "POST", { participant_ids: [who.id], expires_on: until || null, note: note.trim() || null }),
    );
    if (ok) {
      setWho(null);
      setUntil("");
      setNote("");
      setAdding(false);
    }
  };
  const remove = () => run(() => callJson(base, "DELETE"));

  return (
    <article className={panel}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-display text-[18px] leading-[1.25] text-[var(--ink)] break-words">{rec.title}</h3>
          <div className="mt-1 text-[12px] text-[var(--ink-mute)] tabular-nums">
            {rec.duration} · {rec.size}
            {rec.mime_type ? ` · ${rec.mime_type}` : ""}
          </div>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--ink-soft)]">Delete this recording?</span>
            <button type="button" className={btn} onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep
            </button>
            <button type="button" className={`${btn} hover:!border-[#A8321F]/50 hover:!text-[#A8321F]`} onClick={remove} disabled={busy}>
              Delete
            </button>
          </div>
        ) : (
          <button type="button" className={btn} onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      {/* Automatic member access */}
      <div className="mt-4 flex items-start justify-between gap-4 rounded-[var(--radius-md)] bg-[var(--paper-warm)] border border-[var(--paper-shadow)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13.5px] text-[var(--ink)]">Members watch automatically · 会员自动观看</div>
          <div className="mt-0.5 text-[12px] leading-[1.6] text-[var(--ink-soft)]">
            {rec.members_auto
              ? `${memberCount} member${memberCount === 1 ? "" : "s"} registered for this event can watch now, each until their programme ends.`
              : "Off: only the people added below can watch."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rec.members_auto}
          aria-label="Members watch automatically"
          onClick={toggleAuto}
          disabled={busy}
          className={`relative shrink-0 mt-0.5 h-6 w-11 rounded-full transition-[background-color] duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 ${
            rec.members_auto ? "bg-[var(--cinnabar)]" : "bg-[var(--paper-shadow)]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-[var(--paper-warm)] shadow-[0_1px_2px_rgba(20,40,80,0.2)] transition-transform duration-[var(--dur-fast)] ${
              rec.members_auto ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* Added by hand */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className={label}>Added by hand · 手动添加 ({rec.grants.length})</div>
          {!adding ? (
            <button type="button" className={btn} onClick={() => setAdding(true)} disabled={busy}>
              + Add a person
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4">
            <ParticipantPicker value={who} onPick={setWho} />
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <label className="flex flex-col gap-1">
                <span className={label}>Last day (optional)</span>
                <input type="date" className={input} value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Note (optional)</span>
                <input className={input} value={note} maxLength={300} placeholder="e.g. paid for the replay, missed the class" onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} onClick={add} disabled={!who || busy}>
                {busy ? "Adding…" : "Add · 添加"}
              </button>
              <button type="button" className={btn} onClick={() => { setAdding(false); setWho(null); }} disabled={busy}>
                Cancel
              </button>
              <span className="text-[11.5px] text-[var(--ink-mute)]">They see it in their portal under Recordings.</span>
            </div>
          </div>
        ) : null}

        {rec.grants.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--ink-faint)] italic">No one added by hand.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--paper-shadow)]">
            {rec.grants.map((g) => (
              <li key={g.grant_id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <a href={`/admin/participants/${g.id}`} className="text-[13px] text-[var(--ink)] underline decoration-[var(--paper-shadow)] underline-offset-2 hover:text-[var(--cinnabar-deep)]">
                    {g.name}
                  </a>
                  {g.region_id ? <span className="ml-1.5 font-mono text-[11.5px] text-[var(--ink-mute)]">{g.region_id}</span> : null}
                  <span className={`ml-2 text-[12px] tabular-nums ${g.expired ? "text-[#A8321F]" : "text-[var(--ink-soft)]"}`}>
                    {g.until ? `${g.expired ? "ended" : "until"} ${fmtDay(g.until)}` : "no end date"}
                  </span>
                  {g.note ? <span className="ml-2 text-[12px] text-[var(--ink-mute)]">· {g.note}</span> : null}
                </div>
                <button type="button" className={btn} onClick={() => revoke(g)} disabled={busy}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err ? <p className="mt-3 text-[12.5px] text-[#A8321F]">{err}</p> : null}
    </article>
  );
}
