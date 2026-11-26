"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  REQUIRED_FIELD_LABEL,
  type RequiredField,
  type RequiredProfile,
} from "@/lib/participants/required-profile";

// "Complete your profile · 完善资料" — shown on the confirm page when the
// member is missing any of the six details every registration needs
// (Phase 5). Saves through /api/me/profile, then the page reloads.

const field =
  "h-11 w-full px-3.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[14px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const labelCls = "text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

export function CompleteProfileCard({ initial, missing }: { initial: RequiredProfile; missing: RequiredField[] }) {
  const router = useRouter();
  const [v, setV] = useState({
    name_cn: initial.name_cn ?? "",
    name_en: initial.name_en ?? "",
    phone: initial.phone ?? "",
    occupation: initial.occupation ?? "",
    industry: initial.industry ?? "",
    referrer_name: initial.referrer_name ?? "",
    referrer_contact: initial.referrer_contact ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const isMissing = (f: RequiredField) => missing.includes(f);
  const ready =
    Boolean(v.name_cn.trim() || v.name_en.trim()) &&
    [v.phone, v.occupation, v.industry, v.referrer_name, v.referrer_contact].every((x) => x.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) {
      setErr("Please fill in every field. · 请填写所有栏位。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(j.detail ?? "Couldn't save. Please try again.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Please try again.");
      setBusy(false);
    }
  }

  const missingNames = missing.map((f) => `${REQUIRED_FIELD_LABEL[f].en} · ${REQUIRED_FIELD_LABEL[f].zh}`).join(", ");
  const mark = (f: RequiredField) => (isMissing(f) ? "border-[var(--cinnabar)]/50" : "");

  return (
    <form
      onSubmit={save}
      className="mt-8 rounded-[var(--radius-lg)] border border-[var(--cinnabar)]/30 bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]"
      noValidate
    >
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">Step 1 · Complete your profile · 完善资料</div>
      <p className="mt-2 text-[13.5px] leading-[1.7] text-[var(--ink-soft)] max-w-[60ch]">
        Every registration needs these details. Please add: <span className="text-[var(--ink)]">{missingNames}</span>.
        <br />
        每次报名都需要以下资料，请补充后继续。
      </p>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Chinese name · 中文名</span>
          <input className={`${field} ${mark("name")}`} value={v.name_cn} onChange={set("name_cn")} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>English name · 英文名</span>
          <input className={`${field} ${mark("name")}`} value={v.name_en} onChange={set("name_en")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Phone · 电话 *</span>
          <input className={`${field} ${mark("phone")}`} value={v.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" />
        </label>
        <div className="hidden sm:block" />
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Occupation · 职业 *</span>
          <input className={`${field} ${mark("occupation")}`} value={v.occupation} onChange={set("occupation")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Industry · 行业 *</span>
          <input className={`${field} ${mark("industry")}`} value={v.industry} onChange={set("industry")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Referred by · 介绍人 *</span>
          <input className={`${field} ${mark("referrer_name")}`} value={v.referrer_name} onChange={set("referrer_name")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Referrer&apos;s contact · 介绍人联系方式 *</span>
          <input className={`${field} ${mark("referrer_contact")}`} value={v.referrer_contact} onChange={set("referrer_contact")} placeholder="Phone or email · 电话或邮箱" />
        </label>
      </div>

      {err ? (
        <p role="alert" className="mt-4 text-[13px] text-[var(--cinnabar-deep)]">
          {err}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center h-11 px-5 rounded-full bg-[var(--cinnabar)] text-[13px] tracking-[0.04em] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
          style={{ color: "var(--paper-warm)" }}
        >
          {busy ? "Saving…" : "Save and continue · 保存并继续"}
        </button>
      </div>
    </form>
  );
}
