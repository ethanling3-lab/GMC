"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STAFF_REGIONS,
  STAFF_ROLES,
  type StaffMember,
  type StaffRole,
} from "@/lib/staff/roles";

type Notice = {
  name: string;
  text: string;
  setupUrl?: string | null;
};

type Form = {
  name_en: string;
  name_cn: string;
  email: string;
  role: StaffRole;
  region: string;
};

const BLANK: Form = { name_en: "", name_cn: "", email: "", role: "customer_service", region: "" };

const roleLabel = (role: StaffRole) => STAFF_ROLES.find((r) => r.value === role)?.label ?? role;
const nameOf = (s: StaffMember) => s.name_en || s.name_cn || s.email;

const inputClass =
  "mt-1 w-full h-9 px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none disabled:opacity-60 transition-[border-color,box-shadow]";
const smallButton =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[border-color,color,transform]";
const primaryButton =
  "inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] font-medium hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform]";

export function StaffManager({
  staff,
  currentAdminId,
}: {
  staff: StaffMember[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"invite" | StaffMember | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(member: StaffMember, action: "restore" | "send_link" | "remove") {
    setBusy(member.id);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/staff/${member.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
        setup_url?: string | null;
        email_sent?: boolean;
        participants_released?: number;
        conversations_released?: number;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Couldn't save that.");
        return;
      }
      const name = nameOf(member);
      if (action === "send_link") {
        setNotice({
          name,
          setupUrl: json.setup_url,
          text: json.email_sent
            ? `New password link emailed to ${name}.`
            : `The email didn't send. Copy this link and send it to ${name}.`,
        });
      } else if (action === "remove") {
        const p = json.participants_released ?? 0;
        const c = json.conversations_released ?? 0;
        setNotice({
          name,
          text:
            p + c > 0
              ? `${name}'s access is removed. ${p} participant${p === 1 ? "" : "s"} and ${c} conversation${c === 1 ? "" : "s"} are now unassigned.`
              : `${name}'s access is removed.`,
        });
      } else {
        setNotice({ name, text: `${name}'s access is restored.` });
      }
      setRemoving(null);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it.");
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] tabular-nums text-[var(--ink-mute)]">
          {staff.filter((s) => s.status !== "removed").length} with access
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDialog("invite");
          }}
          className={primaryButton}
          style={{ color: "var(--paper-warm)" }}
        >
          Invite staff
        </button>
      </div>

      {notice ? (
        <div role="status" className="mt-4 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--ink)]">
          <div className="flex items-start justify-between gap-3">
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 w-6 h-6 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] focus-visible:shadow-[var(--shadow-focus)] transition-colors">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {notice.setupUrl ? (
            <div className="mt-2 flex items-center gap-2">
              <input readOnly value={notice.setupUrl} aria-label={`Password link for ${notice.name}`} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} !mt-0 font-mono !text-[11.5px]`} />
              <button type="button" onClick={() => copy(notice.setupUrl as string)} className={smallButton}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error && !dialog && !removing ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p>
      ) : null}

      <ul className="mt-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] divide-y divide-[var(--paper-shadow)]">
        {staff.map((s) => {
          const self = s.id === currentAdminId;
          return (
            <li key={s.id} className={`flex items-center justify-between gap-x-4 gap-y-2 flex-wrap px-5 py-3.5 ${s.status === "removed" ? "opacity-70" : ""}`}>
              <div className="min-w-0 flex-1 basis-[240px]">
                <div className="flex items-center gap-2 flex-wrap text-[14px] text-[var(--ink)]">
                  <span className="font-medium">{nameOf(s)}</span>
                  {s.name_en && s.name_cn ? <span className="text-[var(--ink-mute)]">{s.name_cn}</span> : null}
                  {self ? <span className="text-[11.5px] text-[var(--ink-faint)]">You</span> : null}
                </div>
                <div className="text-[12px] text-[var(--ink-mute)] break-all">{s.email || "No email"}</div>
              </div>
              <div className="w-[170px] text-[12.5px] text-[var(--ink-soft)]">
                {roleLabel(s.role)}{s.region ? `, ${s.region}` : ""}
              </div>
              <div className="w-[130px]"><StatusPill status={s.status} lastSignIn={s.last_sign_in_at} /></div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {s.status === "removed" ? (
                  <button type="button" disabled={busy === s.id} onClick={() => act(s, "restore")} className={smallButton} aria-label={`Restore ${nameOf(s)}`}>
                    Restore
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => { setError(null); setDialog(s); }} className={smallButton} aria-label={`Edit ${nameOf(s)}`}>
                      Edit
                    </button>
                    <button type="button" disabled={busy === s.id} onClick={() => act(s, "send_link")} className={smallButton} aria-label={`Send password link to ${nameOf(s)}`}>
                      Send password link
                    </button>
                    {!self ? (
                      <button type="button" onClick={() => { setError(null); setRemoving(s); }} className={`${smallButton} hover:!text-[var(--cinnabar-deep)]`} aria-label={`Remove ${nameOf(s)}`}>
                        Remove
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {dialog ? (
        <StaffDialog
          member={dialog === "invite" ? null : dialog}
          isSelf={dialog !== "invite" && dialog.id === currentAdminId}
          onClose={() => setDialog(null)}
          onSaved={(n) => {
            setDialog(null);
            setCopied(false);
            setNotice(n);
            router.refresh();
          }}
        />
      ) : null}

      {removing ? (
        <Modal title={`Remove ${nameOf(removing)}?`} onClose={() => busy !== removing.id && setRemoving(null)}>
          <p className="text-[13px] leading-[1.6] text-[var(--ink-soft)]">
            They&apos;ll lose staff access straight away. Their past records stay, and
            participants or conversations assigned to them become unassigned. You can
            restore their access later.
          </p>
          {error ? <p role="alert" className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setRemoving(null)} className={smallButton}>Cancel</button>
            <button type="button" disabled={busy === removing.id} onClick={() => act(removing, "remove")} className={primaryButton} style={{ color: "var(--paper-warm)" }}>
              {busy === removing.id ? "Removing…" : "Remove access"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StatusPill({ status, lastSignIn }: { status: StaffMember["status"]; lastSignIn: string | null }) {
  const map = {
    active: { label: "Active", dot: "bg-[#5b9a5d]", text: "text-[#3a6b3b]" },
    invited: { label: "Invited", dot: "bg-[#A87A2A]", text: "text-[#7A5617]" },
    removed: { label: "Removed", dot: "bg-[var(--ink-faint)]", text: "text-[var(--ink-mute)]" },
  }[status];
  return (
    <div>
      <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${map.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} aria-hidden="true" />
        {map.label}
      </span>
      {status === "active" && lastSignIn ? (
        <div className="text-[11px] text-[var(--ink-faint)]">
          Last in {new Date(lastSignIn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      ) : null}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[460px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-2)]">
        <h2 className="mb-4 font-display text-[21px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function StaffDialog({
  member,
  isSelf,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (n: Notice) => void;
}) {
  const [form, setForm] = useState<Form>(
    member
      ? {
          name_en: member.name_en ?? "",
          name_cn: member.name_cn ?? "",
          email: member.email,
          role: member.role,
          region: member.region ?? "",
        }
      : BLANK,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const role = STAFF_ROLES.find((r) => r.value === form.role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const fields = {
      name_en: form.name_en.trim(),
      name_cn: form.name_cn.trim(),
      role: form.role,
      region: form.region || null,
    };
    try {
      const res = await fetch(member ? `/api/admin/staff/${member.id}` : "/api/admin/staff", {
        method: member ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(member ? { action: "update", ...fields } : { ...fields, email: form.email.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
        existing_account?: boolean;
        setup_url?: string | null;
        email_sent?: boolean;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Couldn't save that.");
        setBusy(false);
        return;
      }
      const name = fields.name_en || fields.name_cn;
      if (member) {
        onSaved({ name, text: `${name}'s details are saved.` });
      } else if (json.existing_account) {
        onSaved({
          name,
          text: json.email_sent
            ? `${name} already has an account, so they can sign in with their current password. We've emailed them.`
            : `${name} already has an account and can sign in with their current password. The email didn't send, so please tell them.`,
        });
      } else {
        onSaved({
          name,
          setupUrl: json.setup_url,
          text: json.email_sent
            ? `Invite emailed to ${name}. You can also copy the link and send it on WhatsApp.`
            : `${name} is added, but the email didn't send. Copy this link and send it to them.`,
        });
      }
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <Modal title={member ? `Edit ${nameOf(member)}` : "Invite staff"} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] text-[var(--ink-soft)]">
            English name
            <input value={form.name_en} maxLength={120} onChange={(e) => set("name_en", e.target.value)} className={inputClass} />
          </label>
          <label className="text-[12px] text-[var(--ink-soft)]">
            Chinese name
            <input value={form.name_cn} maxLength={120} onChange={(e) => set("name_cn", e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="text-[12px] text-[var(--ink-soft)]">
          Email
          <input type="email" required value={form.email} disabled={Boolean(member)} onChange={(e) => set("email", e.target.value)} className={inputClass} />
        </label>
        <label className="text-[12px] text-[var(--ink-soft)]">
          Role
          <select value={form.role} disabled={isSelf} onChange={(e) => set("role", e.target.value as StaffRole)} className={inputClass}>
            {STAFF_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label} · {r.labelZh}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] leading-[1.5] text-[var(--ink-mute)]">{role?.description}</span>
        </label>
        <label className="text-[12px] text-[var(--ink-soft)]">
          Region (optional)
          <select value={form.region} disabled={isSelf} onChange={(e) => set("region", e.target.value)} className={inputClass}>
            <option value="">No region</option>
            {STAFF_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {isSelf ? <p className="text-[11.5px] text-[var(--ink-mute)]">Another super admin must change your own role or region.</p> : null}
        {error ? <p role="alert" className="text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={smallButton}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButton} style={{ color: "var(--paper-warm)" }}>
            {busy ? "Saving…" : member ? "Save changes" : "Send invite"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
