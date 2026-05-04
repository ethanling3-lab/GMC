"use client";

import { useEffect, useRef, useState } from "react";
import { CardShell } from "./CardShell";
import { Field, Empty } from "./Field";
import { Textarea } from "./FormControls";
import { useParticipantPatch } from "./useParticipantPatch";

// Relationships card.
//
// Family of (multi):
//   The card edits the FULL desired set of family-link partners; the
//   PATCH route diffs against participant_family_links and applies the
//   delta. Multiple family members in one save (whole family attending
//   the same course, etc.).
//
// Referred by (single):
//   Optional FK on participants.referrer_id. When set, the unverified
//   free-text fallback hides; admin can also clear referrer_id to fall
//   back to the free-text columns (e.g. when re-investigating).

export type RelatedParticipant = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
};

export type RelationshipsData = {
  family_members: RelatedParticipant[];
  referrer: RelatedParticipant | null;
  referrer_name: string | null;
  referrer_contact: string | null;
  referred_by_this: RelatedParticipant[];
};

type SearchHit = RelatedParticipant & {
  email: string | null;
  phone: string | null;
};

function participantLabel(p: { name_en: string | null; name_cn: string | null }) {
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

export function RelationshipsEditor({
  participantId,
  initial,
}: {
  participantId: string;
  initial: RelationshipsData;
}) {
  const [editing, setEditing] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<RelatedParticipant[]>(
    initial.family_members,
  );
  const [referrer, setReferrer] = useState<RelatedParticipant | null>(
    initial.referrer,
  );
  const [referrerName, setReferrerName] = useState(
    initial.referrer_name ?? "",
  );
  const [referrerContact, setReferrerContact] = useState(
    initial.referrer_contact ?? "",
  );
  const { saving, error, setError, patch } = useParticipantPatch(participantId);

  function cancel() {
    setFamilyMembers(initial.family_members);
    setReferrer(initial.referrer);
    setReferrerName(initial.referrer_name ?? "");
    setReferrerContact(initial.referrer_contact ?? "");
    setEditing(false);
    setError(null);
  }

  async function save() {
    const initialIds = new Set(initial.family_members.map((m) => m.id));
    const draftIds = new Set(familyMembers.map((m) => m.id));
    const familyChanged =
      initialIds.size !== draftIds.size ||
      [...draftIds].some((id) => !initialIds.has(id));

    const referrerChanged = (initial.referrer?.id ?? null) !== (referrer?.id ?? null);
    const nameChanged = (initial.referrer_name ?? "") !== referrerName;
    const contactChanged = (initial.referrer_contact ?? "") !== referrerContact;

    const payload: Record<string, unknown> = {};
    if (familyChanged) {
      payload.family_member_ids = familyMembers.map((m) => m.id);
    }
    if (referrerChanged) {
      payload.referrer_id = referrer?.id ?? null;
    }
    if (nameChanged) {
      payload.referrer_name = referrerName.trim() ? referrerName.trim() : null;
    }
    if (contactChanged) {
      payload.referrer_contact = referrerContact.trim()
        ? referrerContact.trim()
        : null;
    }

    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }
    const ok = await patch(payload);
    if (ok) setEditing(false);
  }

  function addFamilyMember(p: RelatedParticipant) {
    if (p.id === participantId) return;
    if (familyMembers.some((m) => m.id === p.id)) return;
    setFamilyMembers([...familyMembers, p]);
  }
  function removeFamilyMember(id: string) {
    setFamilyMembers(familyMembers.filter((m) => m.id !== id));
  }

  return (
    <CardShell
      eyebrow="Relationships"
      eyebrowZh="关系"
      title="Family, referrers & referrals"
      editing={editing}
      saving={saving}
      error={error}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={save}
    >
      {editing ? (
        <div className="flex flex-col gap-7">
          {/* Family of — multi-select with search */}
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Family of · 家人
            </span>
            {familyMembers.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {familyMembers.map((m) => (
                  <li key={m.id}>
                    <FamilyChip p={m} onRemove={() => removeFamilyMember(m.id)} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3">
              <ParticipantSearch
                placeholder="Search to add family members…"
                excludeIds={[
                  participantId,
                  ...familyMembers.map((m) => m.id),
                ]}
                onPick={(hit) => {
                  addFamilyMember({
                    id: hit.id,
                    region_id: hit.region_id,
                    name_en: hit.name_en,
                    name_cn: hit.name_cn,
                  });
                }}
              />
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.55] text-[var(--ink-faint)]">
              Add every family member who attends events together. Algorithm
              splits them across different groups (no two family at the same
              table).
            </p>
          </div>

          {/* Referred by — single-select */}
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Referred by · 感召
            </span>
            {referrer ? (
              <div className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] pl-2.5 pr-1.5 py-1">
                <span className="font-mono text-[11px] text-[var(--cinnabar-deep)]">
                  {referrer.region_id ?? "—"}
                </span>
                <span className="text-[12.5px] text-[var(--ink)]">
                  {participantLabel(referrer)}
                </span>
                <button
                  type="button"
                  onClick={() => setReferrer(null)}
                  className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--ink-faint)] hover:bg-[var(--paper-deep)] hover:text-[var(--cinnabar)]"
                  aria-label="Clear referrer"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="mt-2">
                <ParticipantSearch
                  placeholder="Search to set referrer…"
                  excludeIds={[participantId]}
                  onPick={(hit) =>
                    setReferrer({
                      id: hit.id,
                      region_id: hit.region_id,
                      name_en: hit.name_en,
                      name_cn: hit.name_cn,
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* Referred by (unverified) — free-text fallback */}
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
              Referred by (unverified) · 感召（文字）
            </span>
            <p className="mt-1 mb-2.5 text-[11.5px] leading-[1.55] text-[var(--ink-faint)]">
              Free-text from the registration form. Once you link a verified
              referrer above, leave these blank.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <Textarea
                rows={1}
                value={referrerName}
                onChange={setReferrerName}
                placeholder="Name"
              />
              <Textarea
                rows={1}
                value={referrerContact}
                onChange={setReferrerContact}
                placeholder="Phone or email"
              />
            </div>
          </div>

          {/* Referred by this participant — read-only even in edit mode */}
          {initial.referred_by_this.length > 0 ? (
            <div className="pt-5 border-t border-[var(--paper-shadow)]">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Referred by this participant · 介绍
              </span>
              <ul className="mt-2 flex flex-wrap gap-2">
                {initial.referred_by_this.map((r) => (
                  <li key={r.id}>
                    <ReferredChip p={r} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Field label="Family of" labelZh="家人">
            {initial.family_members.length === 0 ? (
              <Empty />
            ) : (
              <span className="inline-flex flex-wrap gap-1.5">
                {initial.family_members.map((m) => (
                  <ReferredChip key={m.id} p={m} />
                ))}
              </span>
            )}
          </Field>
          <Field label="Referred by" labelZh="感召">
            {initial.referrer ? (
              <ReferredChip p={initial.referrer} />
            ) : initial.referrer_name || initial.referrer_contact ? (
              <span className="inline-flex items-baseline gap-3 flex-wrap">
                {initial.referrer_name ? (
                  <span className="font-display text-[15px] text-[var(--ink)]">
                    {initial.referrer_name}
                  </span>
                ) : null}
                {initial.referrer_contact ? (
                  <span className="font-mono text-[12px] text-[var(--ink-mute)]">
                    {initial.referrer_contact}
                  </span>
                ) : null}
                <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--gold-deep)] bg-[var(--gold-soft)]/60 px-1.5 py-0.5 rounded-full border border-[var(--gold)]/40">
                  Unverified
                </span>
              </span>
            ) : (
              <Empty />
            )}
          </Field>
          <Field label="Referred by this participant" labelZh="介绍">
            {initial.referred_by_this.length === 0 ? (
              <span className="text-[var(--ink-mute)]">None yet.</span>
            ) : (
              <span className="inline-flex flex-wrap gap-1.5">
                {initial.referred_by_this.map((r) => (
                  <ReferredChip key={r.id} p={r} />
                ))}
              </span>
            )}
          </Field>
        </div>
      )}
    </CardShell>
  );
}

function FamilyChip({
  p,
  onRemove,
}: {
  p: RelatedParticipant;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/60 pl-2.5 pr-1 py-1 text-[12px] text-[var(--ink)]">
      {p.region_id ? (
        <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
          {p.region_id}
        </span>
      ) : null}
      <span>{participantLabel(p)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--ink-faint)] hover:bg-[var(--paper)]/70 hover:text-[var(--cinnabar-deep)]"
        aria-label={`Remove ${participantLabel(p)}`}
      >
        ×
      </button>
    </span>
  );
}

function ReferredChip({ p }: { p: RelatedParticipant }) {
  return (
    <a
      href={`/admin/participants/${p.id}`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]"
    >
      {p.region_id ? (
        <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
          {p.region_id}
        </span>
      ) : null}
      <span>{participantLabel(p)}</span>
    </a>
  );
}

function ParticipantSearch({
  placeholder,
  excludeIds,
  onPick,
}: {
  placeholder: string;
  excludeIds: string[];
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const excludeKey = excludeIds.slice().sort().join(",");

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRows([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const sp = new URLSearchParams({ q: trimmed });
        const res = await fetch(
          `/api/admin/participants/search?${sp.toString()}`,
          { signal: ctrl.signal },
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "search failed");
        const all = (payload.rows ?? []) as SearchHit[];
        const excludeSet = new Set(excludeKey.split(",").filter(Boolean));
        setRows(all.filter((r) => !excludeSet.has(r.id)));
        setOpen(true);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, excludeKey]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          className="text-[var(--ink-faint)] flex-none"
        >
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => rows.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        {loading ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="animate-spin text-[var(--ink-mute)]"
          >
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="1.5"
            />
            <path
              d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </div>
      {open && rows.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] shadow-[var(--shadow-paper-1)] divide-y divide-[var(--paper-shadow)]/60"
        >
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setRows([]);
                  setOpen(false);
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--paper-deep)]/55 transition-colors duration-[var(--dur-fast)]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
                    {r.region_id ?? "—"}
                  </span>
                  <span className="text-[13px] text-[var(--ink)]">
                    {participantLabel(r)}
                  </span>
                </div>
                {r.email || r.phone ? (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--ink-mute)] font-mono">
                    {r.email ? <span>{r.email}</span> : null}
                    {r.phone ? <span>{r.phone}</span> : null}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && q.trim().length >= 2 && !loading && rows.length === 0 ? (
        <div className="mt-2 text-[12px] text-[var(--ink-mute)] italic">
          No matches.
        </div>
      ) : null}
    </div>
  );
}
