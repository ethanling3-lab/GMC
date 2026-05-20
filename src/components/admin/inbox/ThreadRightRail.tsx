"use client";

import { useState } from "react";
import type { ConversationListRow, EnrollmentSummary } from "@/lib/inbox/inbox-query";
import type { FlightInfoEnrollmentRow } from "@/lib/inbox/flight-info-query";
import { ParticipantCard } from "./ParticipantCard";
import { FlightInfoPanel } from "./FlightInfoPanel";

// Right rail on the thread view. Tabs two contexts into a single column:
//   - Profile  : participant identity + enrolments (was its own stacked card)
//   - Travel   : flight info rows (was its own stacked card)
// Consolidates what used to be two separate paper cards stacked vertically,
// keeping the rail narrow (300px) and avoiding the layered-card visual
// clutter the user flagged.

type Tab = "profile" | "travel";

export function ThreadRightRail({
  participant,
  enrollments,
  conversationStatus,
  assignedAdmin,
  conversationId,
  flightRows,
}: {
  participant: ConversationListRow["participant"];
  enrollments: EnrollmentSummary[];
  conversationStatus: string;
  assignedAdmin: ConversationListRow["assigned_admin"];
  conversationId: string;
  flightRows: FlightInfoEnrollmentRow[];
}) {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="w-full h-full flex flex-col bg-[var(--paper-warm)]">
      <div
        role="tablist"
        aria-label="Thread context"
        className="flex-none flex border-b border-[var(--paper-shadow)]"
      >
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          label="Profile"
          labelZh="资料"
        />
        <TabButton
          active={tab === "travel"}
          onClick={() => setTab("travel")}
          label="Travel"
          labelZh="行程"
          badge={flightRows.length > 0 ? flightRows.length : undefined}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === "profile" ? (
          <ParticipantCard
            participant={participant}
            enrollments={enrollments}
            conversationStatus={conversationStatus}
            assignedAdmin={assignedAdmin}
          />
        ) : (
          <FlightInfoPanel
            conversationId={conversationId}
            rows={flightRows}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  labelZh,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  labelZh: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "flex-1 inline-flex items-center justify-center gap-2 h-11",
        "text-[11px] tracking-[0.16em] uppercase",
        "transition-[color,background-color,box-shadow] duration-[var(--dur-fast)]",
        "focus-visible:shadow-[var(--shadow-focus)]",
        active
          ? "text-[var(--cinnabar-deep)] bg-[var(--cinnabar-wash)] border-b-2 border-[var(--cinnabar)] -mb-px"
          : "text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]",
      ].join(" ")}
    >
      <span className="font-display tracking-[-0.005em] text-[12.5px] normal-case">
        {label}
      </span>
      <span className="text-[9.5px] tracking-[0.18em] text-[var(--ink-faint)]">
        {labelZh}
      </span>
      {badge !== undefined ? (
        <span className="ml-0.5 tabular-nums text-[9.5px] tracking-[0.04em] text-[var(--ink-mute)] bg-[var(--paper-deep)] px-1.5 rounded-full">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
