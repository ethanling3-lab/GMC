"use client";

import { useEffect, useState } from "react";
import type { ConversationListRow, EnrollmentSummary } from "@/lib/inbox/inbox-query";
import { ParticipantCard } from "./ParticipantCard";
import { SnippetsRailPanel } from "./SnippetsRailPanel";

// Right rail on the thread view. Tabs two contexts into a single column:
//   - Profile  : participant identity + enrolments
//   - Snippets : org-shared canned replies (manage from inside the thread).
//
// MessageComposer's slash menu dispatches "inbox-open-snippets-tab" when
// admin clicks "Manage →"; we switch to the Snippets tab in response.

type Tab = "profile" | "snippets";

export function ThreadRightRail({
  participant,
  enrollments,
  conversationStatus,
  canManageSnippets,
}: {
  participant: ConversationListRow["participant"];
  enrollments: EnrollmentSummary[];
  conversationStatus: string;
  canManageSnippets: boolean;
}) {
  const [tab, setTab] = useState<Tab>("profile");

  useEffect(() => {
    function onOpenSnippets() {
      setTab("snippets");
    }
    window.addEventListener("inbox-open-snippets-tab", onOpenSnippets);
    return () =>
      window.removeEventListener("inbox-open-snippets-tab", onOpenSnippets);
  }, []);

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
          active={tab === "snippets"}
          onClick={() => setTab("snippets")}
          label="Quick replies"
          labelZh="快捷回复"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === "profile" ? (
          <ParticipantCard
            participant={participant}
            enrollments={enrollments}
            conversationStatus={conversationStatus}
          />
        ) : (
          <SnippetsRailPanel canWrite={canManageSnippets} />
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  labelZh: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-11 px-2",
        "text-[11px] tracking-[0.16em] uppercase",
        "transition-[color,background-color,box-shadow] duration-[var(--dur-fast)]",
        "focus-visible:shadow-[var(--shadow-focus)]",
        active
          ? "text-[var(--cinnabar-deep)] bg-[var(--cinnabar-wash)] border-b-2 border-[var(--cinnabar)] -mb-px"
          : "text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]",
      ].join(" ")}
    >
      <span className="font-display tracking-[-0.005em] text-[12px] normal-case truncate">
        {label}
      </span>
      <span className="text-[9.5px] tracking-[0.18em] text-[var(--ink-faint)] hidden sm:inline">
        {labelZh}
      </span>
    </button>
  );
}
