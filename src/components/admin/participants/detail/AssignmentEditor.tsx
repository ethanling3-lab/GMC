"use client";

import { useState } from "react";
import { CardShell } from "./CardShell";
import { LabelRow, Select } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

export type AdminOption = {
  id: string;
  name_en: string | null;
  name_cn: string | null;
  role: string;
  region: string | null;
};

const ADMIN_ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  regional_lead: "Regional Lead",
  customer_service: "Customer Service",
  finance: "Finance",
  instructor: "Instructor",
};

function adminName(a: AdminOption): string {
  const en = a.name_en?.trim();
  const cn = a.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

function initials(a: AdminOption): string {
  const src = (a.name_en ?? a.name_cn ?? "").trim();
  if (!src) return "·";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function AssignmentEditor({
  participantId,
  initial,
  regionLeads,
  customerService,
}: {
  participantId: string;
  initial: {
    assigned_region_lead_id: string | null;
    assigned_cs_id: string | null;
  };
  regionLeads: AdminOption[];
  customerService: AdminOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  const leadOptions = regionLeads.map((a) => ({
    value: a.id,
    label: `${adminName(a)}${a.region ? ` · ${a.region}` : ""}`,
  }));
  const csOptions = customerService.map((a) => ({
    value: a.id,
    label: adminName(a),
  }));

  function cancel() {
    setDraft(initial);
    setEditing(false);
    setError(null);
  }

  async function save() {
    const ok = await patch(draft);
    if (ok) setEditing(false);
  }

  const lead = regionLeads.find((a) => a.id === initial.assigned_region_lead_id) ?? null;
  const cs = customerService.find((a) => a.id === initial.assigned_cs_id) ?? null;

  return (
    <CardShell
      eyebrow="Assignments"
      eyebrowZh="分配"
      title="Team owners"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-5">
          <LabelRow label="Regional lead" labelZh="地区主管">
            <Select
              value={draft.assigned_region_lead_id}
              onChange={(v) =>
                setDraft({ ...draft, assigned_region_lead_id: v })
              }
              options={leadOptions}
              placeholder="Unassigned"
            />
          </LabelRow>
          <LabelRow label="Customer service" labelZh="客服">
            <Select
              value={draft.assigned_cs_id}
              onChange={(v) => setDraft({ ...draft, assigned_cs_id: v })}
              options={csOptions}
              placeholder="Unassigned"
            />
          </LabelRow>
        </div>
      ) : (
        <dl className="flex flex-col gap-4">
          <AssignmentRow
            label="Regional lead"
            labelZh="地区主管"
            admin={lead}
          />
          <AssignmentRow
            label="Customer service"
            labelZh="客服"
            admin={cs}
          />
        </dl>
      )}
    </CardShell>
  );
}

function AssignmentRow({
  label,
  labelZh,
  admin,
}: {
  label: string;
  labelZh: string;
  admin: AdminOption | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-none
                    ${admin ? "bg-[var(--ink)] text-[var(--paper-warm)]" : "bg-[var(--paper)] border border-dashed border-[var(--paper-shadow)] text-[var(--ink-faint)]"}
                    text-[10px] tracking-[0.06em] font-medium`}
        aria-hidden="true"
      >
        {admin ? initials(admin) : "·"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          {label}
          <span className="ml-1 text-[var(--ink-faint)]/70 tracking-[0.14em] normal-case">
            {labelZh}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-[var(--ink)] truncate">
          {admin ? adminName(admin) : (
            <span className="text-[var(--ink-mute)]">Unassigned</span>
          )}
        </div>
        {admin ? (
          <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--cinnabar)]">
            {ADMIN_ROLE_LABEL[admin.role] ?? admin.role}
          </div>
        ) : null}
      </div>
    </div>
  );
}
