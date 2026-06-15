"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  INTERPOLATION_TOKENS,
  type AudienceFilter,
  type BroadcastChannel,
  type EventCohortFilter,
  type EnrollmentStatusForBroadcast,
  type ParticipantMasterFilter,
} from "@/lib/broadcasts/types";

// Composer for /admin/broadcasts/new — single-page vertical wizard:
//   1. Name + channels
//   2. Audience (event-cohort or participant-master tab)
//   3. Content (WhatsApp template + bilingual email, conditional on channels)
//   4. Send (now / schedule)
//
// On Save draft / Send now / Schedule the composer POSTs to the API to
// create the broadcast row, then either redirects to detail or kicks
// send/schedule before redirect.

type EventOption = {
  id: string;
  title_en: string | null;
  title_cn: string | null;
  status: string;
  start_date: string | null;
  city: string | null;
  slug: string;
};

type TemplateSummary = {
  name: string;
  category: string;
  label_en: string;
  label_cn: string;
  languages: string[];
  params: Array<{ key: string; label_en: string; label_cn: string }>;
  body_by_language: Record<string, string | undefined>;
};

const ENROLLMENT_STATUSES: Array<{ value: EnrollmentStatusForBroadcast; label_en: string; label_cn: string }> = [
  { value: "pending_approval", label_en: "Pending approval", label_cn: "待审核" },
  { value: "approved", label_en: "Approved", label_cn: "已通过" },
  { value: "rejected", label_en: "Rejected", label_cn: "已拒绝" },
  { value: "paid", label_en: "Paid", label_cn: "已付款" },
  { value: "cancelled", label_en: "Cancelled", label_cn: "已取消" },
];

const REGIONS = ["MY", "SG", "TW", "HK", "CN"] as const;

const PROGRAMME_TIERS: Array<{ value: string; label_cn: string }> = [
  { value: "abundance", label_cn: "丰盛" },
  { value: "glorious_family", label_cn: "荣贵" },
  { value: "elite_cultural_heritage", label_cn: "精英文化财" },
  { value: "glorious_cultural_heritage", label_cn: "荣耀文化财" },
];

const MOTIVATIONS: Array<{ value: string; label_en: string; label_cn: string }> = [
  { value: "clean", label_en: "Clean", label_cn: "干净" },
  { value: "insurance", label_en: "Insurance", label_cn: "保险" },
  { value: "direct_sales", label_en: "Direct sales", label_cn: "直销" },
  { value: "spiritual", label_en: "Spiritual", label_cn: "灵性" },
  { value: "other", label_en: "Other", label_cn: "其他" },
];

// When present, the composer edits an existing draft/scheduled broadcast
// (PATCH) instead of creating a new one (POST). Populated by the edit page.
export type ExistingBroadcast = {
  id: string;
  name: string;
  channels: BroadcastChannel[];
  audience_mode: "event_cohort" | "participant_master";
  audience_filter: AudienceFilter;
  whatsapp_template_name: string | null;
  whatsapp_template_language: "en_US" | "zh_CN" | null;
  whatsapp_template_params: Record<string, string> | null;
  email_subject_en: string | null;
  email_subject_cn: string | null;
  email_body_en: string | null;
  email_body_cn: string | null;
  scheduled_for: string | null;
};

// ISO timestamp → value for <input type="datetime-local">. Timezone-dependent,
// so this only ever runs client-side (in a mount effect) to avoid SSR/client
// hydration mismatch on the seeded value.
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BroadcastComposer({
  adminRegion,
  events,
  existing,
}: {
  adminRegion: string | null;
  events: EventOption[];
  existing?: ExistingBroadcast;
}) {
  const router = useRouter();
  const isEdit = Boolean(existing);

  // Seed event-cohort / participant-master state from the existing filter
  // when editing. Both branches are derived once for the useState initializers.
  const ec =
    existing && existing.audience_filter.mode === "event_cohort"
      ? existing.audience_filter
      : null;
  const pm =
    existing && existing.audience_filter.mode === "participant_master"
      ? existing.audience_filter
      : null;

  const [name, setName] = useState(existing?.name ?? "");
  const [channels, setChannels] = useState<BroadcastChannel[]>(existing?.channels ?? ["whatsapp"]);
  const [audienceMode, setAudienceMode] = useState<"event_cohort" | "participant_master">(
    existing?.audience_mode ?? "event_cohort",
  );

  // Event-cohort state
  const [eventId, setEventId] = useState<string>(ec?.event_id ?? events[0]?.id ?? "");
  const [enrollmentStatuses, setEnrollmentStatuses] = useState<EnrollmentStatusForBroadcast[]>(
    ec?.enrollment_statuses ?? ["approved", "paid"],
  );
  const [languageFilter, setLanguageFilter] = useState<"" | "en" | "cn" | "both">(
    ec?.language ?? "",
  );
  const [tagSlug, setTagSlug] = useState<string>(ec?.tag_slug ?? "");

  // Participant-master state
  const [region, setRegion] = useState<string>(pm ? (pm.region ?? "") : (adminRegion ?? ""));
  const [masterStatuses, setMasterStatuses] = useState<string[]>(
    pm?.status ?? ["active", "cs_enriched"],
  );
  const [motivation, setMotivation] = useState<string>(pm?.motivation ?? "");
  const [programmeTier, setProgrammeTier] = useState<string>(pm?.programme_tier ?? "");
  const [isOldStudent, setIsOldStudent] = useState<"" | "true" | "false">(
    pm ? (pm.is_old_student === null ? "" : pm.is_old_student ? "true" : "false") : "",
  );

  // WhatsApp content
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSummary | null>(null);
  const [templateLanguage, setTemplateLanguage] = useState<"en_US" | "zh_CN">(
    existing?.whatsapp_template_language ?? "zh_CN",
  );
  const [templateParams, setTemplateParams] = useState<Record<string, string>>(
    existing?.whatsapp_template_params ?? {},
  );

  // Email content
  const [emailSubjectEn, setEmailSubjectEn] = useState(existing?.email_subject_en ?? "");
  const [emailSubjectCn, setEmailSubjectCn] = useState(existing?.email_subject_cn ?? "");
  const [emailBodyEn, setEmailBodyEn] = useState(existing?.email_body_en ?? "");
  const [emailBodyCn, setEmailBodyCn] = useState(existing?.email_body_cn ?? "");

  // Send mode
  const [sendMode, setSendMode] = useState<"now" | "schedule">(
    existing?.scheduled_for ? "schedule" : "now",
  );
  const [scheduledFor, setScheduledFor] = useState<string>("");

  // Seed the schedule input client-side only (timezone-dependent → can't be a
  // useState initializer without risking a hydration mismatch).
  useEffect(() => {
    if (existing?.scheduled_for) {
      setScheduledFor(toLocalDatetimeInput(existing.scheduled_for));
    }
  }, [existing]);

  // Audience preview (debounced)
  const [preview, setPreview] = useState<{
    matched: number;
    reachable: number;
    excluded_no_address: number;
    excluded_out_of_region: number;
    preview: Array<{
      participant_id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      channels: string[];
    }>;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Fetch WhatsApp templates when whatsapp channel is selected.
  useEffect(() => {
    if (!channels.includes("whatsapp")) return;
    if (templates.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/inbox/templates");
        const body = (await res.json()) as { templates?: TemplateSummary[] };
        if (!cancelled) setTemplates(body.templates ?? []);
      } catch {
        // silently leave empty — the picker shows "Loading…" indefinitely;
        // user can refresh
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channels, templates.length]);

  // When editing, re-select the saved template object once the registry loads.
  // Set directly (not via onSelect) so the saved template params are preserved.
  const templateSeededRef = useRef(false);
  useEffect(() => {
    if (templateSeededRef.current) return;
    if (!existing?.whatsapp_template_name || templates.length === 0) return;
    const match = templates.find((t) => t.name === existing.whatsapp_template_name);
    if (match) {
      setSelectedTemplate(match);
      templateSeededRef.current = true;
    }
  }, [templates, existing]);

  const filter: AudienceFilter = useMemo(() => {
    if (audienceMode === "event_cohort") {
      return {
        mode: "event_cohort",
        event_id: eventId,
        enrollment_statuses: enrollmentStatuses,
        language: languageFilter === "" ? null : languageFilter,
        tag_slug: tagSlug.trim() === "" ? null : tagSlug.trim(),
      } satisfies EventCohortFilter;
    }
    return {
      mode: "participant_master",
      region: region === "" ? null : region,
      status: masterStatuses.length > 0 ? (masterStatuses as ParticipantMasterFilter["status"]) : null,
      motivation: motivation === "" ? null : (motivation as ParticipantMasterFilter["motivation"]),
      programme_tier:
        programmeTier === "" ? null : (programmeTier as ParticipantMasterFilter["programme_tier"]),
      is_old_student: isOldStudent === "" ? null : isOldStudent === "true",
      require_any_of_channels: channels,
    } satisfies ParticipantMasterFilter;
  }, [
    audienceMode,
    eventId,
    enrollmentStatuses,
    languageFilter,
    tagSlug,
    region,
    masterStatuses,
    motivation,
    programmeTier,
    isOldStudent,
    channels,
  ]);

  // Debounced audience preview fetch.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (audienceMode === "event_cohort" && !eventId) {
      setPreview(null);
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await fetch("/api/admin/broadcasts/audience-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            audience_mode: audienceMode,
            audience_filter: filter,
            channels,
          }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { detail?: string };
          setPreviewError(body.detail ?? `Preview failed (${res.status})`);
          setPreview(null);
        } else {
          setPreview(await res.json());
        }
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : "Preview failed");
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [audienceMode, eventId, filter, channels]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit(action: "draft" | "send" | "schedule") {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Validation
      if (!name.trim()) throw new Error("Name is required");
      if (channels.length === 0) throw new Error("Pick at least one channel");
      if (audienceMode === "event_cohort" && !eventId) {
        throw new Error("Pick an event");
      }
      if (channels.includes("whatsapp") && !selectedTemplate) {
        throw new Error("Pick a WhatsApp template");
      }
      if (
        channels.includes("email") &&
        !(emailSubjectEn.trim() || emailSubjectCn.trim()) &&
        action !== "draft"
      ) {
        throw new Error("Add an email subject for at least one locale");
      }
      if (action === "schedule" && !scheduledFor) {
        throw new Error("Pick a date/time to schedule");
      }

      const createBody = {
        name: name.trim(),
        audience_mode: audienceMode,
        audience_filter: filter,
        channels,
        whatsapp_template_name: selectedTemplate?.name ?? null,
        whatsapp_template_language: channels.includes("whatsapp") ? templateLanguage : null,
        whatsapp_template_params: channels.includes("whatsapp") ? templateParams : null,
        email_subject_en: emailSubjectEn.trim() || null,
        email_subject_cn: emailSubjectCn.trim() || null,
        email_body_en: emailBodyEn.trim() || null,
        email_body_cn: emailBodyCn.trim() || null,
      };

      let targetId: string;
      if (existing) {
        const patchRes = await fetch(`/api/admin/broadcasts/${existing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createBody),
        });
        if (!patchRes.ok) {
          const body = (await patchRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `Save failed (${patchRes.status})`);
        }
        targetId = existing.id;
      } else {
        const createRes = await fetch("/api/admin/broadcasts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createBody),
        });
        if (!createRes.ok) {
          const body = (await createRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `Create failed (${createRes.status})`);
        }
        targetId = ((await createRes.json()) as { id: string }).id;
      }

      if (action === "send") {
        const sendRes = await fetch(`/api/admin/broadcasts/${targetId}/send`, {
          method: "POST",
        });
        if (!sendRes.ok && sendRes.status !== 202) {
          const body = (await sendRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `Send failed (${sendRes.status})`);
        }
      } else if (action === "schedule") {
        const dt = new Date(scheduledFor);
        const scheduleRes = await fetch(`/api/admin/broadcasts/${targetId}/schedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scheduled_for: dt.toISOString() }),
        });
        if (!scheduleRes.ok) {
          const body = (await scheduleRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `Schedule failed (${scheduleRes.status})`);
        }
      }

      router.push(`/admin/broadcasts/${targetId}`);
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — Name + channels */}
      <SectionCard step="01" titleEn="Name & channels" titleCn="名称与渠道">
        <div className="space-y-4">
          <label className="block">
            <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
              Internal name · 内部名称
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Day-of venue change · 2026-06-15"
              maxLength={120}
              className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30 transition-colors"
            />
          </label>
          <div>
            <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
              Channels · 渠道
            </div>
            <div className="flex gap-2">
              {(["whatsapp", "email"] as BroadcastChannel[]).map((c) => {
                const active = channels.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setChannels((curr) =>
                        curr.includes(c) ? curr.filter((x) => x !== c) : [...curr, c],
                      )
                    }
                    className={`inline-flex items-center gap-2 px-3 h-10 rounded-[var(--radius-md)] border text-[13px] tracking-[0.04em] uppercase transition-colors ${
                      active
                        ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                        : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                    }`}
                  >
                    {c === "whatsapp" ? "WhatsApp" : "Email · 邮件"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Step 2 — Audience */}
      <SectionCard step="02" titleEn="Audience" titleCn="受众">
        <div className="flex gap-1 mb-4">
          {(["event_cohort", "participant_master"] as const).map((m) => {
            const active = audienceMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setAudienceMode(m)}
                className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.12em] uppercase transition-colors ${
                  active
                    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                }`}
              >
                {m === "event_cohort" ? "Event cohort · 活动报名" : "Participant master · 学员总表"}
              </button>
            );
          })}
        </div>

        {audienceMode === "event_cohort" ? (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                Event · 活动
              </span>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {[e.title_en, e.title_cn].filter(Boolean).join(" · ") || e.slug}
                    {e.start_date ? ` (${e.start_date})` : ""}
                    {` — ${e.status}`}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                Enrolment status · 报名状态
              </div>
              <div className="flex flex-wrap gap-2">
                {ENROLLMENT_STATUSES.map((s) => {
                  const active = enrollmentStatuses.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() =>
                        setEnrollmentStatuses((curr) =>
                          curr.includes(s.value)
                            ? curr.filter((x) => x !== s.value)
                            : [...curr, s.value],
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.08em] uppercase transition-colors ${
                        active
                          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                          : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                      }`}
                    >
                      {s.label_en} · {s.label_cn}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Language · 语言
                </span>
                <select
                  value={languageFilter}
                  onChange={(e) =>
                    setLanguageFilter(e.target.value as "" | "en" | "cn" | "both")
                  }
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
                >
                  <option value="">Any · 任意</option>
                  <option value="en">English</option>
                  <option value="cn">中文</option>
                  <option value="both">Both · 双语</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Tag · 标签 (slug)
                </span>
                <input
                  type="text"
                  value={tagSlug}
                  onChange={(e) => setTagSlug(e.target.value)}
                  placeholder="vip"
                  maxLength={40}
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Region · 区域 {adminRegion ? "(forced to your region)" : ""}
                </span>
                <select
                  value={region}
                  disabled={Boolean(adminRegion)}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30 disabled:opacity-60"
                >
                  <option value="">All regions · 全部</option>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Programme tier · 课程级别
                </span>
                <select
                  value={programmeTier}
                  onChange={(e) => setProgrammeTier(e.target.value)}
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
                >
                  <option value="">Any · 任意</option>
                  {PROGRAMME_TIERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label_cn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Motivation · 动机
                </span>
                <select
                  value={motivation}
                  onChange={(e) => setMotivation(e.target.value)}
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
                >
                  <option value="">Any · 任意</option>
                  {MOTIVATIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label_en} · {m.label_cn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                  Old student · 旧学员
                </span>
                <select
                  value={isOldStudent}
                  onChange={(e) => setIsOldStudent(e.target.value as "" | "true" | "false")}
                  className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
                >
                  <option value="">Either · 不限</option>
                  <option value="true">Old students · 旧学员</option>
                  <option value="false">New students · 新学员</option>
                </select>
              </label>
            </div>
            <div>
              <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
                Status · 状态
              </div>
              <div className="flex flex-wrap gap-2">
                {["new", "info_verified", "cs_enriched", "active", "inactive"].map((s) => {
                  const active = masterStatuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setMasterStatuses((curr) =>
                          curr.includes(s)
                            ? curr.filter((x) => x !== s)
                            : [...curr, s],
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.08em] uppercase transition-colors ${
                        active
                          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                          : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <AudienceLivePreview
          preview={preview}
          loading={previewLoading}
          error={previewError}
        />
      </SectionCard>

      {/* Step 3 — Content */}
      {(channels.includes("whatsapp") || channels.includes("email")) ? (
        <SectionCard step="03" titleEn="Content" titleCn="内容">
          {channels.includes("whatsapp") ? (
            <div className="mb-6">
              <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--cinnabar)] mb-3">
                WhatsApp · 模板
              </div>
              <WhatsAppTemplateBlock
                templates={templates}
                selected={selectedTemplate}
                language={templateLanguage}
                params={templateParams}
                onSelect={(t) => {
                  setSelectedTemplate(t);
                  // reset params keyed to {{1}}, {{2}}, ...
                  const seed: Record<string, string> = {};
                  t.params.forEach((p, i) => {
                    seed[`variable_${i + 1}`] = "";
                    void p; // labels rendered separately
                  });
                  setTemplateParams(seed);
                }}
                onLanguageChange={setTemplateLanguage}
                onParamChange={(k, v) =>
                  setTemplateParams((curr) => ({ ...curr, [k]: v }))
                }
              />
            </div>
          ) : null}

          {channels.includes("email") ? (
            <div>
              <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--cinnabar)] mb-3">
                Email · 邮件
              </div>
              <BilingualEmailEditor
                subjectEn={emailSubjectEn}
                subjectCn={emailSubjectCn}
                bodyEn={emailBodyEn}
                bodyCn={emailBodyCn}
                onChange={(field, val) => {
                  if (field === "subjectEn") setEmailSubjectEn(val);
                  else if (field === "subjectCn") setEmailSubjectCn(val);
                  else if (field === "bodyEn") setEmailBodyEn(val);
                  else setEmailBodyCn(val);
                }}
              />
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {/* Step 4 — Send */}
      <SectionCard step="04" titleEn="Send" titleCn="发送">
        <div className="flex gap-2 mb-4">
          {(["now", "schedule"] as const).map((m) => {
            const active = sendMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setSendMode(m)}
                className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.1em] uppercase transition-colors ${
                  active
                    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                }`}
              >
                {m === "now" ? "Send now · 立即发送" : "Schedule · 排程"}
              </button>
            );
          })}
        </div>
        {sendMode === "schedule" ? (
          <label className="block max-w-md">
            <span className="block text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
              Send at · 发送时间
            </span>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[14px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
            />
          </label>
        ) : null}
      </SectionCard>

      {/* Submit bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 px-5 py-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)]">
        <div className="text-[12px] text-[var(--ink-soft)]">
          {preview ? (
            <>
              <span className="text-[var(--ink)] font-medium">{preview.reachable}</span>{" "}
              reachable
              {preview.matched !== preview.reachable ? (
                <span className="ml-1 text-[var(--ink-faint)]">
                  · {preview.matched - preview.reachable} excluded
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[var(--ink-faint)]">Preview loading…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {submitError ? (
            <span className="text-[11.5px] text-[var(--cinnabar-deep)] mr-2">{submitError}</span>
          ) : null}
          <button
            type="button"
            onClick={() => submit("draft")}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
          >
            {isEdit ? "Save changes" : "Save draft"}
          </button>
          {sendMode === "now" ? (
            <button
              type="button"
              onClick={() => submit("send")}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              style={{ color: "var(--paper-warm)" }}
            >
              {submitting ? "Sending…" : "Send now"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit("schedule")}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              style={{ color: "var(--paper-warm)" }}
            >
              {submitting ? "Scheduling…" : "Schedule"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  step,
  titleEn,
  titleCn,
  children,
}: {
  step: string;
  titleEn: string;
  titleCn: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-display text-[14px] tabular-nums text-[var(--cinnabar)]">{step}</span>
        <h2 className="font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
          {titleEn}
          <span className="ml-2 text-[12px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {titleCn}
          </span>
        </h2>
      </div>
      {children}
    </section>
  );
}

function AudienceLivePreview({
  preview,
  loading,
  error,
}: {
  preview: {
    matched: number;
    reachable: number;
    excluded_no_address: number;
    excluded_out_of_region: number;
    preview: Array<{
      participant_id: string;
      region_id: string | null;
      name_cn: string | null;
      name_en: string | null;
      channels: string[];
    }>;
  } | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-5 pt-5 border-t border-[var(--paper-shadow)]">
      <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
        <div>
          <div className="text-[10px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Audience preview · 受众预览
          </div>
        </div>
        <div className="text-right">
          {loading ? (
            <span className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-faint)]">
              Resolving…
            </span>
          ) : error ? (
            <span className="text-[11px] tracking-[0.08em] text-[var(--cinnabar-deep)]">
              {error}
            </span>
          ) : preview ? (
            <div className="text-[11.5px] tracking-[0.06em] tabular-nums text-[var(--ink-soft)]">
              <span className="font-display text-[18px] text-[var(--ink)] mr-1.5">
                {preview.reachable}
              </span>
              reachable
              <span className="ml-2 text-[var(--ink-faint)]">
                · {preview.matched} matched · {preview.excluded_no_address} no address
              </span>
              {preview.excluded_out_of_region > 0 ? (
                <span className="ml-2 text-[var(--gold)]">
                  · {preview.excluded_out_of_region} out of region
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {preview && preview.preview.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                <th className="pb-2 font-normal">Region ID</th>
                <th className="pb-2 font-normal">Name</th>
                <th className="pb-2 font-normal">Channels</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((p) => (
                <tr key={p.participant_id} className="border-t border-[var(--paper-shadow)]">
                  <td className="py-1.5 pr-3 text-[var(--ink-soft)] tabular-nums">
                    {p.region_id ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--ink)]">
                    {[p.name_cn, p.name_en].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-1.5 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
                    {p.channels.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.reachable > preview.preview.length ? (
            <p className="mt-2 text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              + {preview.reachable - preview.preview.length} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WhatsAppTemplateBlock({
  templates,
  selected,
  language,
  params,
  onSelect,
  onLanguageChange,
  onParamChange,
}: {
  templates: TemplateSummary[];
  selected: TemplateSummary | null;
  language: "en_US" | "zh_CN";
  params: Record<string, string>;
  onSelect: (t: TemplateSummary) => void;
  onLanguageChange: (l: "en_US" | "zh_CN") => void;
  onParamChange: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {templates.length === 0 ? (
        <p className="text-[12px] text-[var(--ink-mute)]">Loading approved templates…</p>
      ) : (
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
            Template · 模板
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => {
              const active = selected?.name === t.name;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => onSelect(t)}
                  className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.08em] uppercase transition-colors ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                  }`}
                >
                  {t.label_en}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected ? (
        <>
          <div>
            <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mb-1.5">
              Language · 语言
            </div>
            <div className="flex gap-2">
              {(selected.languages as Array<"en_US" | "zh_CN">).map((lang) => {
                const active = language === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => onLanguageChange(lang)}
                    className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-[var(--radius-pill)] border text-[11px] tracking-[0.08em] uppercase transition-colors ${
                      active
                        ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                        : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]"
                    }`}
                  >
                    {lang === "en_US" ? "English" : "中文"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
              Template variables · 模板变量
            </div>
            {selected.params.map((p, i) => {
              const key = `variable_${i + 1}`;
              return (
                <div key={key}>
                  <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] mb-1">
                    {`{{${i + 1}}}`} · {p.label_en} · {p.label_cn}
                  </div>
                  <ParamInputWithTokens
                    value={params[key] ?? ""}
                    onChange={(v) => onParamChange(key, v)}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function BilingualEmailEditor({
  subjectEn,
  subjectCn,
  bodyEn,
  bodyCn,
  onChange,
}: {
  subjectEn: string;
  subjectCn: string;
  bodyEn: string;
  bodyCn: string;
  onChange: (field: "subjectEn" | "subjectCn" | "bodyEn" | "bodyCn", val: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
          English
        </div>
        <ParamInputWithTokens value={subjectEn} onChange={(v) => onChange("subjectEn", v)} placeholder="Subject" />
        <BodyTextareaWithTokens value={bodyEn} onChange={(v) => onChange("bodyEn", v)} />
      </div>
      <div className="space-y-2">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
          中文
        </div>
        <ParamInputWithTokens value={subjectCn} onChange={(v) => onChange("subjectCn", v)} placeholder="主题" />
        <BodyTextareaWithTokens value={bodyCn} onChange={(v) => onChange("bodyCn", v)} />
      </div>
    </div>
  );
}

function ParamInputWithTokens({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[13px] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
      />
      <TokenChipRow
        onInsert={(t) => {
          const el = ref.current;
          if (!el) {
            onChange(value + t);
            return;
          }
          const start = el.selectionStart ?? value.length;
          const end = el.selectionEnd ?? value.length;
          onChange(value.slice(0, start) + t + value.slice(end));
        }}
      />
    </div>
  );
}

function BodyTextareaWithTokens({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        placeholder="Body (HTML allowed)"
        className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[13px] leading-[1.65] text-[var(--ink)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-1 focus:ring-[var(--cinnabar)]/30"
      />
      <TokenChipRow
        onInsert={(t) => {
          const el = ref.current;
          if (!el) {
            onChange(value + t);
            return;
          }
          const start = el.selectionStart ?? value.length;
          const end = el.selectionEnd ?? value.length;
          onChange(value.slice(0, start) + t + value.slice(end));
        }}
      />
    </div>
  );
}

function TokenChipRow({ onInsert }: { onInsert: (t: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {INTERPOLATION_TOKENS.map((spec) => (
        <button
          key={spec.token}
          type="button"
          onClick={() => onInsert(spec.token)}
          title={`${spec.label_en} · ${spec.label_cn}`}
          className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[9.5px] tracking-[0.06em] text-[var(--ink-mute)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/40 transition-colors font-mono"
        >
          {spec.token}
        </button>
      ))}
    </div>
  );
}
