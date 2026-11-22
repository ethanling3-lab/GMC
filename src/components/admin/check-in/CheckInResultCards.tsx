"use client";

import { groupNumber } from "@/lib/group-number";
import type { CheckInPerson } from "@/lib/check-in/types";
import { EVENT_TZ } from "@/lib/check-in/day";

// Result cards shown over the camera at a check-in desk: registration
// (checked in / already / unpaid) and, during class, out / back.
//
// The badges are printed in advance and sorted into piles by group, so after
// a scan the desk's only job is "find this name in that pile". The group
// number is therefore the biggest thing on the card, with the name next —
// seat and region ID are secondary.

export type DeskPerson = Partial<CheckInPerson>;

function displayName(p: DeskPerson): string {
  return p.participant?.name_cn ?? p.participant?.name_en ?? "—";
}

function GroupBlock({ person }: { person: DeskPerson }) {
  const g = groupNumber({
    group_no: person.group_no ?? null,
    table_no: person.table_no ?? null,
  });
  if (g.no === null) {
    return (
      <div className="mt-4 rounded-[14px] bg-[var(--paper-deep)] px-4 py-3 text-[15px] text-[var(--ink-soft)]">
        No group yet · 未分组
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-[14px] bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/25 px-4 py-3">
      <div className="text-[12px] text-[var(--cinnabar-deep)]">
        {g.placed ? "Group · 组" : "Group (no table yet) · 组（未编桌）"}
      </div>
      <div className="font-display text-[64px] leading-none tracking-[-0.03em] text-[var(--cinnabar-deep)] tabular-nums">
        {g.no}
      </div>
      {person.seat_no != null ? (
        <div className="mt-1 text-[13px] text-[var(--ink-soft)] tabular-nums">
          Seat {person.seat_no} · 座位 {person.seat_no}
        </div>
      ) : null}
    </div>
  );
}

function NameBlock({ person }: { person: DeskPerson }) {
  const alt =
    person.participant?.name_cn && person.participant?.name_en
      ? person.participant.name_en
      : null;
  return (
    <>
      <div className="font-display text-[34px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)] break-words">
        {displayName(person)}
      </div>
      <div className="mt-1 text-[13px] text-[var(--ink-mute)] tabular-nums">
        {[alt, person.participant?.region_id].filter(Boolean).join(" · ")}
      </div>
    </>
  );
}

function Icon({ kind }: { kind: "ok" | "warn" | "error" | "out" }) {
  const bg =
    kind === "ok"
      ? "var(--cinnabar)"
      : kind === "warn" || kind === "out"
        ? "var(--gold-deep, #A87A2A)"
        : "#B91C1C";
  return (
    <div
      className="flex items-center justify-center w-11 h-11 rounded-full mx-auto mb-3"
      style={{ background: bg }}
      aria-hidden="true"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {kind === "ok" ? (
          <polyline points="5 12 10 17 19 8" />
        ) : kind === "out" ? (
          <>
            <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
            <polyline points="9 8 5 12 9 16" />
            <line x1="5" y1="12" x2="15" y2="12" />
          </>
        ) : (
          <>
            <line x1="12" y1="7.5" x2="12" y2="13" />
            <circle cx="12" cy="16.5" r="0.8" fill="#fff" />
          </>
        )}
      </svg>
    </div>
  );
}

const cardShell =
  "bg-[var(--paper-warm)] border rounded-[20px] px-6 py-6 shadow-[var(--shadow-elevated)] w-full max-w-[400px] text-center";

const secondaryBtn =
  "inline-flex items-center justify-center h-11 px-5 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-shadow)] text-[13px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] active:bg-[var(--paper-deep)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,border-color,color] duration-[var(--dur-fast)]";

export function CheckInSuccessCard({
  person,
  unpaidOverride = false,
}: {
  person: DeskPerson;
  unpaidOverride?: boolean;
}) {
  return (
    <div role="status" className={`${cardShell} border-[var(--paper-deep)]`}>
      <Icon kind="ok" />
      <div className="text-[13px] font-medium text-[var(--cinnabar)] mb-2">
        Checked in · 已签到
        {unpaidOverride ? <span className="text-[var(--ink-mute)] font-normal"> · unpaid</span> : null}
      </div>
      <NameBlock person={person} />
      <GroupBlock person={person} />
    </div>
  );
}

export function CheckInAlreadyCard({
  person,
  checkedInAt,
  sessionLabel,
  onDismiss,
}: {
  person: DeskPerson;
  checkedInAt?: string | null;
  /** "Morning · 早上" — which registration they're already in. */
  sessionLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className={`${cardShell} border-[var(--gold,#C99B47)]`}>
      <Icon kind="warn" />
      <div className="text-[14px] font-medium text-[var(--ink)] mb-2">
        Already checked in · 已签到 ({sessionLabel})
        {checkedInAt ? (
          <span className="text-[var(--ink-mute)] font-normal tabular-nums"> · {formatTime(checkedInAt)}</span>
        ) : null}
      </div>
      {person.participant ? (
        <>
          <NameBlock person={person} />
          <GroupBlock person={person} />
        </>
      ) : null}
      <button type="button" onClick={onDismiss} className={`${secondaryBtn} mt-4`}>
        OK · 好
      </button>
    </div>
  );
}

export function CheckInUnpaidCard({
  person,
  posting,
  onConfirm,
  onCancel,
}: {
  person: DeskPerson;
  posting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label="Not paid" className={`${cardShell} border-[var(--gold,#C99B47)]`}>
      <Icon kind="warn" />
      <div className="text-[15px] font-medium text-[var(--ink)]">Not paid · 未付款</div>
      <p className="mt-1 mb-3 text-[13px] leading-[1.5] text-[var(--ink-soft)]">
        Approved but no payment recorded. Check in only if a manager agreed.
      </p>
      <NameBlock person={person} />
      <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
        <button
          type="button"
          onClick={onConfirm}
          disabled={posting}
          className="inline-flex items-center justify-center h-11 px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[13px] font-medium text-[var(--paper)] hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform] duration-[var(--dur-fast)]"
        >
          {posting ? "Checking in…" : "Check in anyway · 仍然签到"}
        </button>
        <button type="button" onClick={onCancel} disabled={posting} className={secondaryBtn}>
          Cancel · 取消
        </button>
      </div>
    </div>
  );
}

export function CheckInErrorCard({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className={`${cardShell} border-[#B91C1C]/50`}>
      <Icon kind="error" />
      <div className="text-[16px] leading-snug text-[var(--ink)]">{message}</div>
      <button type="button" onClick={onDismiss} className={`${secondaryBtn} mt-4`}>
        Dismiss · 关闭
      </button>
    </div>
  );
}

// --- Out of class ------------------------------------------------------------

export type ClassAction = "out" | "back" | "already_out" | "already_back";

/**
 * Out / back result. "Out" is the one to notice (they're leaving), so it
 * carries the warm colour; "back" is a quiet confirmation with the minutes.
 * Not checked in for this session → warning + one-tap check-in.
 */
export function ClassScanCard({
  person,
  action,
  outAt,
  minutes,
  notCheckedIn,
  checkingIn,
  onCheckInNow,
  onDismiss,
}: {
  person: DeskPerson;
  action: ClassAction;
  outAt: string | null;
  minutes: number | null;
  notCheckedIn: boolean;
  checkingIn: boolean;
  onCheckInNow: () => void;
  onDismiss: () => void;
}) {
  const out = action === "out" || action === "already_out";
  const headline =
    action === "out"
      ? `Out · 外出${outAt ? ` ${formatTime(outAt)}` : ""}`
      : action === "already_out"
        ? `Already out · 已外出${outAt ? ` since ${formatTime(outAt)}` : ""}`
        : action === "back"
          ? `Back · 回来${minutes !== null ? ` · out ${minutes} min` : ""}`
          : "Already back · 已回来";
  return (
    <div
      role="status"
      className={`${cardShell} ${out ? "border-[#A87A2A]" : "border-[var(--paper-deep)]"}`}
    >
      <Icon kind={out ? "out" : "ok"} />
      <div
        className={`text-[15px] font-medium mb-2 tabular-nums ${
          out ? "text-[var(--gold-deep,#A87A2A)]" : "text-[var(--cinnabar)]"
        }`}
      >
        {headline}
      </div>
      <NameBlock person={person} />
      <GroupBlock person={person} />
      {notCheckedIn ? (
        <div className="mt-4 rounded-[14px] border border-[#A87A2A] bg-[#A87A2A]/10 px-4 py-3 text-left">
          <div className="text-[13px] font-medium text-[var(--ink)]">
            Not checked in this session · 本时段未签到
          </div>
          <div className="mt-0.5 text-[12px] leading-[1.5] text-[var(--ink-soft)]">
            Their exit is logged anyway. Check them in if they were in class.
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onCheckInNow}
              disabled={checkingIn}
              className="inline-flex items-center justify-center h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[13px] font-medium text-[var(--paper)] hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform] duration-[var(--dur-fast)]"
            >
              {checkingIn ? "Checking in…" : "Check in now · 立即签到"}
            </button>
            <button type="button" onClick={onDismiss} className={`${secondaryBtn} h-10`}>
              Skip · 跳过
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Bilingual message for a check-in API error code. */
export function checkInErrorMessage(code: string): string {
  switch (code) {
    case "locked":
      return "Check-in is only open on the event dates · 活动日期才开放签到";
    case "break":
      return "Official break — nothing is logged · 官方休息，不登记";
    case "mode_changed":
      return "The organizer just switched mode. Scan again · 模式已切换，请重新扫码";
    case "wrong_event":
      return "This QR is for a different event · 此二维码不属于本场活动";
    case "not_eligible":
      return "Enrolment not approved, or cancelled · 报名未批准或已取消";
    case "invalid_token":
    case "not_found":
      return "QR not recognised · 二维码无效";
    case "forbidden":
      return "This account can't check people in · 无签到权限";
    default:
      return `Check-in failed · 签到失败 (${code})`;
  }
}

/** "Day 2 · 第2天" chip for desk headers. */
export function DayChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[24px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[11.5px] text-[var(--ink-soft)] tabular-nums">
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: EVENT_TZ,
    });
  } catch {
    return "";
  }
}
