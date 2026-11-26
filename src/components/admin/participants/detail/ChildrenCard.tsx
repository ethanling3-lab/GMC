"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ParticipantPicker, type ParticipantHit } from "@/components/admin/events/ParticipantPicker";
import type { ChildRow } from "@/lib/participants/children";
import { CardShell } from "./CardShell";

// Children · 子女 / Parent · 家长 on a participant's page (migration 084).
// A child has no own contact or login; their parent registers them and
// receives their messages. Super Admin adds / links / unlinks.

const btn =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-40 transition-[border-color,color,transform] duration-[var(--dur-fast)]";
const primary =
  "inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";
const input =
  "h-9 w-full px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const label = "text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

type Parent = { id: string; region_id: string | null; name_cn: string | null; name_en: string | null; email: string | null; phone: string | null };

function age(birth: string | null): string | null {
  if (!birth) return null;
  const b = new Date(birth);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a -= 1;
  return a >= 0 ? `${a} yrs` : null;
}

export function ChildrenCard({
  participantId,
  participantName,
  childList,
  parents,
  canEdit,
  self,
}: {
  participantId: string;
  participantName: string;
  childList: ChildRow[];
  parents: Parent[];
  canEdit: boolean;
  /** This profile's own contact + login, for "Give own login". */
  self: { isMinor: boolean; email: string | null; hasLogin: boolean };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "new" | "link">("none");
  const [form, setForm] = useState({ name_cn: "", name_en: "", birth_date: "", gender: "" });
  const [pick, setPick] = useState<ParticipantHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [own, setOwn] = useState({ open: false, email: "", phone: "" });

  const giveOwnLogin = () =>
    run(async () => {
      const res = await fetch(`/api/admin/participants/${participantId}/own-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: own.email, phone: own.phone || null }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string; invite?: string };
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `Failed (${res.status})`);
      const sentTo = own.email.trim();
      setOwn({ open: false, email: "", phone: "" });
      return j.invite === "sent"
        ? `✓ ${participantName} now has their own contact. A set-password link was sent to ${sentTo}.`
        : `✓ ${participantName} now has their own contact. The link couldn't be emailed; they can use "Set up account" on the sign-in page with ${sentTo}.`;
    });

  async function call(method: string, body: unknown) {
    const res = await fetch(`/api/admin/participants/${participantId}/children`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string; created?: boolean };
    if (!res.ok) throw new Error(j.detail ?? j.error ?? `Failed (${res.status})`);
    return j;
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await fn() });
      setMode("none");
      router.refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const addNew = () =>
    run(async () => {
      const j = await call("POST", { mode: "new", name_cn: form.name_cn, name_en: form.name_en || null, birth_date: form.birth_date, gender: form.gender || null });
      const n = form.name_cn.trim();
      setForm({ name_cn: "", name_en: "", birth_date: "", gender: "" });
      return j.created === false ? `${n} is already ${participantName}'s child.` : `✓ Added ${n}.`;
    });

  const link = () =>
    pick &&
    run(async () => {
      await call("POST", { mode: "link", child_id: pick.id });
      const n = pick.name_cn || pick.name_en || "them";
      setPick(null);
      return `✓ ${n} is now ${participantName}'s child.`;
    });

  const unlink = (c: ChildRow) => {
    if (!window.confirm(`Unlink ${c.name_cn ?? c.name_en} from ${participantName}? Their profile and registrations stay.`)) return;
    void run(async () => {
      await call("DELETE", { child_id: c.id });
      return `✓ Unlinked ${c.name_cn ?? c.name_en}.`;
    });
  };

  return (
    <CardShell eyebrow="Family" eyebrowZh="家长 · 子女" title="Parent and children" editing={false} editable={false}>
      {notice ? (
        <p className={`mt-3 text-[12.5px] ${notice.ok ? "text-[var(--ink-soft)]" : "text-[var(--cinnabar-deep)]"}`}>{notice.text}</p>
      ) : null}

      {parents.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[13.5px] font-medium text-[var(--ink)]">Parent · 家长</h3>
          {self.isMinor ? (
            <p className="mt-1 text-[12px] text-[var(--ink-mute)]">Messages about {participantName}&apos;s registrations go to this contact.</p>
          ) : null}
          <ul className="mt-2 flex flex-col">
            {parents.map((g) => (
              <li key={g.id} className="py-2 border-b border-[var(--paper-shadow)] last:border-b-0">
                <Link href={`/admin/participants/${g.id}`} className="text-[13.5px] text-[var(--ink)] hover:text-[var(--cinnabar-deep)] underline decoration-[var(--paper-shadow)] underline-offset-2">
                  {g.name_cn || g.name_en}
                </Link>
                {g.region_id ? <span className="ml-2 font-mono text-[11.5px] text-[var(--ink-mute)]">{g.region_id}</span> : null}
                <div className="mt-0.5 text-[12px] text-[var(--ink-soft)]">{[g.email, g.phone].filter(Boolean).join(" · ") || "No contact on file"}</div>
              </li>
            ))}
          </ul>

          {self.isMinor && !self.hasLogin ? (
            canEdit ? (
              own.open ? (
                <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <p className="md:col-span-2 text-[12px] text-[var(--ink-soft)]">
                    {participantName} gets their own email and login and receives their own messages. They stay linked to their parent.
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className={label}>Their email · 邮箱</span>
                    <input type="email" className={input} value={own.email} onChange={(e) => setOwn({ ...own, email: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={label}>Their phone (optional)</span>
                    <input type="tel" className={input} value={own.phone} onChange={(e) => setOwn({ ...own, phone: e.target.value })} />
                  </label>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => setOwn({ open: false, email: "", phone: "" })}>Close</button>
                    <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy || !own.email.includes("@")} onClick={giveOwnLogin}>
                      Give own login
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <button type="button" className={btn} onClick={() => setOwn({ ...own, open: true })}>Give own login · 独立账户</button>
                </div>
              )
            ) : null
          ) : !self.isMinor ? (
            <p className="mt-2 text-[12px] text-[var(--ink-mute)]">
              {participantName} has their own contact{self.hasLogin ? " and login" : ""}; messages go to them, not the parent.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-[13.5px] font-medium text-[var(--ink)]">Children · 子女</h3>
        {childList.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--ink-faint)] italic">No children linked to {participantName}.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {childList.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--paper-shadow)] last:border-b-0">
                <div className="min-w-0">
                  <Link href={`/admin/participants/${c.id}`} className="text-[13.5px] text-[var(--ink)] hover:text-[var(--cinnabar-deep)] underline decoration-[var(--paper-shadow)] underline-offset-2">
                    {c.name_cn || c.name_en}
                  </Link>
                  {c.name_en && c.name_cn ? <span className="ml-1.5 text-[12px] text-[var(--ink-soft)]">{c.name_en}</span> : null}
                  <span className="ml-2 text-[11.5px] text-[var(--ink-mute)] tabular-nums">
                    {[c.birth_date, age(c.birth_date), c.region_id].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {canEdit ? (
                  <button type="button" className={btn} disabled={busy} onClick={() => unlink(c)}>
                    Unlink
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit && mode === "none" ? (
          <div className="mt-3 flex gap-2 flex-wrap">
            <button type="button" className={btn} onClick={() => setMode("new")}>+ Add a child</button>
            <button type="button" className={btn} onClick={() => setMode("link")}>Link an existing profile</button>
          </div>
        ) : null}

        {canEdit && mode === "new" ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>Chinese name · 中文名</span>
              <input className={input} value={form.name_cn} onChange={(e) => setForm({ ...form, name_cn: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>English name (optional)</span>
              <input className={input} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Birth date · 出生日期</span>
              <input type="date" className={input} max={new Date().toISOString().slice(0, 10)} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Gender · 性别</span>
              <select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male · 男</option>
                <option value="female">Female · 女</option>
              </select>
            </label>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" className={btn} disabled={busy} onClick={() => setMode("none")}>Close</button>
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy || !form.name_cn.trim() || !form.birth_date} onClick={addNew}>
                Add child
              </button>
            </div>
          </div>
        ) : null}

        {canEdit && mode === "link" ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4">
            <span className={label}>Make this profile {participantName}&apos;s child</span>
            <div className="mt-1.5">
              <ParticipantPicker value={pick} onPick={setPick} />
            </div>
            {pick && pick.id === participantId ? (
              <p className="mt-2 text-[12px] text-[var(--cinnabar-deep)]">A person can&apos;t be their own child.</p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className={btn} disabled={busy} onClick={() => { setMode("none"); setPick(null); }}>Close</button>
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy || !pick || pick.id === participantId} onClick={link}>
                Link as child
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
