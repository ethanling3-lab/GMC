"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QueueRow } from "@/lib/participants/assign-queue";
import { segmentLabel } from "@/lib/participants/segment";
import { btn, callJson, input, panel, primary } from "@/components/admin/payments/ui";

// To assign · 待分配 (Phase 3, 2026-11-26). The Super Admin checks who
// brought each person and assigns a CS. A suggestion (the referrer's or
// parent's CS) is one click; nothing is assigned until clicked.

type Cs = { id: string; name: string };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function AssignQueueClient({ rows, cs }: { rows: QueueRow[]; cs: Cs[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const csName = (id: string | null) => cs.find((c) => c.id === id)?.name ?? null;

  const assign = async (pairs: Array<{ id: string; cs: string }>, key: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const byCs = new Map<string, string[]>();
      for (const p of pairs) byCs.set(p.cs, [...(byCs.get(p.cs) ?? []), p.id]);
      for (const [csId, ids] of byCs) {
        await callJson("/api/admin/participants/bulk", "POST", { action: "assign_cs", ids, assigned_cs_id: csId });
      }
      setDone((d) => new Set([...d, ...pairs.map((p) => p.id)]));
      setMsg({ ok: true, text: pairs.length === 1 ? `✓ Assigned to ${csName(pairs[0].cs)}.` : `✓ Assigned ${pairs.length} people.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not assign" });
    } finally {
      setBusy(null);
    }
  };

  const open = rows.filter((r) => !done.has(r.id));
  const suggested = open.filter((r) => r.suggested_cs_id && csName(r.suggested_cs_id));

  if (open.length === 0) {
    return (
      <section className={panel}>
        <p className="text-[14px] text-[var(--ink)]">Everyone has a CS. New sign-ups will appear here.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink-soft)]">
          {open.length} to assign{suggested.length ? ` · ${suggested.length} with a suggested CS` : ""}
        </p>
        {suggested.length > 1 ? (
          <button
            type="button"
            className={primary}
            style={{ color: "var(--paper-warm)" }}
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Assign ${suggested.length} people to their suggested CS? Check the referrals first.`)) return;
              void assign(suggested.map((r) => ({ id: r.id, cs: r.suggested_cs_id! })), "all");
            }}
          >
            {busy === "all" ? "Assigning…" : `Assign all suggested (${suggested.length})`}
          </button>
        ) : null}
      </div>
      {msg ? <p className={`text-[13px] ${msg.ok ? "text-[var(--jade-deep)]" : "text-[#A8321F]"}`}>{msg.text}</p> : null}

      <section className={`${panel} p-0 overflow-x-auto`}>
        <table className="w-full min-w-[880px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-[var(--ink-mute)] border-b border-[var(--paper-shadow)]">
              <th className="px-4 py-2.5 font-normal">Person</th>
              <th className="px-4 py-2.5 font-normal">Joined</th>
              <th className="px-4 py-2.5 font-normal">Brought by · 介绍人</th>
              <th className="px-4 py-2.5 font-normal">Assign CS · 分配客服</th>
            </tr>
          </thead>
          <tbody>
            {open.map((r) => {
              const sug = csName(r.suggested_cs_id);
              const chosen = pick[r.id] ?? "";
              return (
                <tr key={r.id} className="border-b border-[var(--paper-shadow)] last:border-b-0 align-top">
                  <td className="px-4 py-3">
                    <Link href={`/admin/participants/${r.id}`} className="text-[var(--ink)] underline decoration-[var(--paper-shadow)] underline-offset-2 hover:text-[var(--cinnabar-deep)]">
                      {r.name_cn || r.name_en || "—"}
                    </Link>
                    {r.name_cn && r.name_en ? <span className="ml-1.5 text-[12px] text-[var(--ink-soft)]">{r.name_en}</span> : null}
                    {r.region_id ? <span className="ml-1.5 font-mono text-[11px] text-[var(--ink-mute)]">{r.region_id}</span> : null}
                    <div className="text-[12px] text-[var(--ink-soft)]">
                      {[segmentLabel(r.segment) ?? (r.region === "MY" ? "马来西亚 · region not picked" : r.region), r.phone].filter(Boolean).join(" · ") || "No contact"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-[var(--ink-soft)]">
                    <div className="tabular-nums">{fmt(r.created_at)}</div>
                    {r.latest_event ? <div className="text-[12px] text-[var(--ink-mute)]">{r.latest_event}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-[12.5px]">
                    {r.parent ? (
                      <div>
                        Child of{" "}
                        <Link href={`/admin/participants/${r.parent.id}`} className="underline underline-offset-2 hover:text-[var(--cinnabar-deep)]">
                          {r.parent.name}
                        </Link>
                      </div>
                    ) : null}
                    {r.referrer ? (
                      <div>
                        <Link href={`/admin/participants/${r.referrer.id}`} className="text-[var(--ink)] underline underline-offset-2 hover:text-[var(--cinnabar-deep)]">
                          {r.referrer.name}
                        </Link>
                        {r.referrer.region_id ? <span className="ml-1 font-mono text-[11px] text-[var(--ink-mute)]">{r.referrer.region_id}</span> : null}
                        <div className="text-[12px] text-[var(--ink-soft)]">Their CS: {csName(r.referrer.cs_id) ?? "none yet"}</div>
                      </div>
                    ) : null}
                    {r.referrer_text && !r.referrer ? <div className="text-[var(--ink-soft)]">{r.referrer_text}</div> : null}
                    {!r.referrer && !r.referrer_text && !r.parent ? <span className="text-[var(--ink-faint)]">Not given</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2 min-w-[220px]">
                      {sug ? (
                        <button
                          type="button"
                          className={primary}
                          style={{ color: "var(--paper-warm)" }}
                          disabled={busy !== null}
                          onClick={() => void assign([{ id: r.id, cs: r.suggested_cs_id! }], r.id)}
                        >
                          {busy === r.id ? "Assigning…" : `Assign to ${sug} (suggested)`}
                        </button>
                      ) : null}
                      <div className="flex gap-2">
                        <select
                          className={`${input} h-8 text-[12.5px]`}
                          value={chosen}
                          onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}
                          aria-label={`Choose a CS for ${r.name_cn || r.name_en}`}
                        >
                          <option value="">{sug ? "Or choose…" : "Choose a CS…"}</option>
                          {cs.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={btn}
                          disabled={!chosen || busy !== null}
                          onClick={() => void assign([{ id: r.id, cs: chosen }], r.id)}
                        >
                          Assign
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
