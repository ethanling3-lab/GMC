"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BadgePreview } from "./BadgePreview";
import { MIN_PLATE_CONTRAST, contrastRatio, detectCjkFont } from "@/lib/badges/draw";
import {
  TOKEN_PREFIX_LEN,
  type BadgePayload,
  type BadgePrintedItem,
  type BadgeRow,
  type BadgeSettings,
} from "@/lib/badges/types";
import { downloadBlob } from "@/lib/floor-plan/export-png";

type Props = {
  eventId: string;
  eventSlug: string;
  initialSettings: BadgeSettings;
  canEdit: boolean;
  initialEnrollmentId: string | null;
};

type Scope = "all" | "changed" | "ids";
type Busy = null | "saving" | "uploading" | { scope: Scope; label: string };

const SAMPLE = {
  name: "林光德",
  // Same length as a real `<nonce>.<hmac>` token, so the module density matches.
  token: "PREVIEW0000000000000000.0000000000000000000000000000000000000000000",
};

const LAYOUT_KEYS = [
  "ink_color",
  "qr_plate",
  "plate_fill",
  "plate_ink",
  "name_center_pct",
  "qr_top_pct",
  "qr_size_mm",
] as const;

function layoutOf(s: BadgeSettings) {
  return Object.fromEntries(LAYOUT_KEYS.map((k) => [k, s[k]]));
}

export function BadgesClient({
  eventId,
  eventSlug,
  initialSettings,
  canEdit,
  initialEnrollmentId,
}: Props) {
  const [settings, setSettings] = useState<BadgeSettings>(initialSettings);
  const [saved, setSaved] = useState<BadgeSettings>(initialSettings);
  const [rows, setRows] = useState<BadgeRow[] | null>(null);
  const [missingTokens, setMissingTokens] = useState(0);
  const [duplicateEnrolments, setDuplicateEnrolments] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialEnrollmentId);
  const [query, setQuery] = useState("");
  const [cjkFont, setCjkFont] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    JSON.stringify(layoutOf(settings)) !== JSON.stringify(layoutOf(saved));

  const refreshRows = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${eventId}/badges`, { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "load_failed");
    const payload = (await res.json()) as BadgePayload;
    setRows(payload.rows);
    setMissingTokens(payload.missing_token_count);
    setDuplicateEnrolments(payload.duplicate_enrollment_count);
    // The loader re-signs the background URL; keep the freshest one.
    setSettings((s) => ({ ...s, bg_url: payload.settings.bg_url }));
  }, [eventId]);

  useEffect(() => {
    setCjkFont(detectCjkFont());
    refreshRows().catch((e) => setError(explain(e)));
  }, [refreshRows]);

  const counts = useMemo(() => {
    const c = { paid: 0, printed: 0, new: 0, changed: 0 };
    for (const r of rows ?? []) {
      c.paid++;
      if (r.status === "new") c.new++;
      else c.printed++;
      if (r.status === "changed") c.changed++;
    }
    return c;
  }, [rows]);

  const selected = rows?.find((r) => r.enrollment_id === selectedId) ?? null;
  const previewRow = selected ?? rows?.[0] ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return [];
    return rows
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.region_id ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, rows]);

  function patch<K extends keyof BadgeSettings>(key: K, value: BadgeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setNotice(null);
  }

  async function save(): Promise<boolean> {
    setBusy("saving");
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/badge-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layoutOf(settings)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "save_failed");
      setSaved(settings);
      setNotice("Design saved.");
      return true;
    } catch (e) {
      setError(explain(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("uploading");
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/events/${eventId}/badge-settings`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail ?? body.error ?? "upload_failed");
      const next = body.settings as BadgeSettings;
      setSettings((s) => ({ ...s, bg_url: next.bg_url, bg_original_filename: next.bg_original_filename }));
      setSaved((s) => ({ ...s, bg_url: next.bg_url, bg_original_filename: next.bg_original_filename }));
      setNotice("Design uploaded.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeDesign() {
    setBusy("uploading");
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/badge-settings`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete_failed");
      setSettings((s) => ({ ...s, bg_url: null, bg_original_filename: null }));
      setSaved((s) => ({ ...s, bg_url: null, bg_original_filename: null }));
      setNotice("Design removed.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function download(scope: Scope, label: string, ids?: string[]) {
    setError(null);
    setNotice(null);
    // Print what's on screen: an unsaved tweak would otherwise print one way
    // and be forgotten the next time someone opens the page.
    if (dirty && canEdit && !(await save())) return;

    setBusy({ scope, label });
    setProgress("Loading attendees…");
    try {
      const qs = scope === "ids" ? `scope=ids&ids=${ids!.join(",")}` : `scope=${scope}`;
      const res = await fetch(`/api/admin/events/${eventId}/badges?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "load_failed");
      const payload = (await res.json()) as BadgePayload;
      if (payload.rows.length === 0) {
        setNotice(scope === "changed" ? "Nothing new or changed since the last print." : "No paid attendees to print.");
        return;
      }

      const { renderBadgesPdf } = await import("@/lib/badges/render-pdf");
      const blob = await renderBadgesPdf(
        payload.rows,
        { ...settings, bg_url: payload.settings.bg_url },
        (done, total) => setProgress(`Drawing badge ${done} of ${total}…`),
      );
      const suffix =
        scope === "ids"
          ? payload.rows.length === 1
            ? `-${payload.rows[0].region_id ?? "single"}`
            : "-selected"
          : scope === "changed"
            ? "-new-and-changed"
            : "-all";
      downloadBlob(blob, `${eventSlug || eventId}-badges${suffix}.pdf`);

      const items: BadgePrintedItem[] = payload.rows.map((r) => ({
        enrollment_id: r.enrollment_id,
        name: r.name,
        display_no: r.display_no,
        seat_no: r.seat_no,
        token_prefix: r.token.slice(0, TOKEN_PREFIX_LEN),
      }));
      await fetch(`/api/admin/events/${eventId}/badges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, items }),
      }).catch(() => undefined);

      const pages = Math.ceil(payload.rows.length / 10);
      setNotice(
        `Downloaded ${payload.rows.length} badge${payload.rows.length === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}. Print at 100% (Actual size).`,
      );
      await refreshRows();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const plateContrast = contrastRatio(settings.plate_fill, settings.plate_ink);
  const working = busy !== null;
  const noDesign = !settings.bg_url;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] items-start">
      <div className="flex flex-col gap-8 min-w-0 order-2 lg:order-1">
        {/* Design */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
          <Eyebrow>Design · 设计</Eyebrow>

          <Field label="Background · 底图" hint="PNG or JPEG of one badge, portrait. It's cropped to fill 54 × 85 mm.">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                id="badge-bg-file"
                disabled={!canEdit || working}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
              <label
                htmlFor="badge-bg-file"
                aria-disabled={!canEdit || working}
                className={`${pillBtn} ${!canEdit || working ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
              >
                {busy === "uploading" ? "Uploading…" : noDesign ? "Upload design" : "Replace design"}
              </label>
              {settings.bg_original_filename ? (
                <span className="text-[12.5px] text-[var(--ink-soft)] truncate max-w-[24ch]" title={settings.bg_original_filename}>
                  {settings.bg_original_filename}
                </span>
              ) : (
                <span className="text-[12.5px] text-[var(--ink-mute)]">No design yet</span>
              )}
              {!noDesign && canEdit ? (
                <button type="button" onClick={removeDesign} disabled={working} className={linkBtn}>
                  Remove
                </button>
              ) : null}
            </div>
          </Field>

          <Field
            label={settings.qr_plate ? "Name colour · 字色" : "Name & QR colour · 字色"}
            hint="Pick a colour that stands out on your design."
          >
            <ColorInput
              value={settings.ink_color}
              disabled={!canEdit}
              label={settings.qr_plate ? "Name colour" : "Name and QR colour"}
              onChange={(v) => patch("ink_color", v)}
            />
          </Field>

          <Field
            label="QR style · 二维码样式"
            hint="See-through matches your sample. Use a plate if a scanner can't read the see-through code."
          >
            <div role="radiogroup" aria-label="QR style" className="inline-flex items-center h-9 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-0.5">
              <Segment active={!settings.qr_plate} disabled={!canEdit} onClick={() => patch("qr_plate", false)}>
                See-through
              </Segment>
              <Segment active={settings.qr_plate} disabled={!canEdit} onClick={() => patch("qr_plate", true)}>
                Plate
              </Segment>
            </div>
            {settings.qr_plate ? (
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
                <div>
                  <div className="text-[12px] text-[var(--ink-soft)] mb-1.5">Plate · 底板</div>
                  <ColorInput
                    value={settings.plate_fill}
                    disabled={!canEdit}
                    label="Plate colour"
                    onChange={(v) => patch("plate_fill", v)}
                  />
                </div>
                <div>
                  <div className="text-[12px] text-[var(--ink-soft)] mb-1.5">QR on plate · 二维码</div>
                  <ColorInput
                    value={settings.plate_ink}
                    disabled={!canEdit}
                    label="QR colour on the plate"
                    onChange={(v) => patch("plate_ink", v)}
                  />
                </div>
              </div>
            ) : null}
            {settings.qr_plate && plateContrast < MIN_PLATE_CONTRAST ? (
              <p role="status" className="mt-3 text-[12px] text-[var(--cinnabar-deep)]">
                The QR and plate colours are too close to scan reliably. Make the QR
                much darker than the plate.
              </p>
            ) : null}
          </Field>

          <Slider
            label="Name position · 名字位置"
            value={settings.name_center_pct}
            min={20}
            max={80}
            step={0.5}
            unit="% from top"
            disabled={!canEdit}
            onChange={(v) => patch("name_center_pct", v)}
          />
          <Slider
            label="QR position · 二维码位置"
            value={settings.qr_top_pct}
            min={30}
            max={85}
            step={0.5}
            unit="% from top"
            disabled={!canEdit}
            onChange={(v) => patch("qr_top_pct", v)}
          />
          <Slider
            label="QR size · 二维码大小"
            value={settings.qr_size_mm}
            min={18}
            max={44}
            step={0.5}
            unit="mm"
            disabled={!canEdit}
            onChange={(v) => patch("qr_size_mm", v)}
          />

          {canEdit ? (
            <div className="mt-6 flex items-center gap-3">
              <button type="button" onClick={save} disabled={!dirty || working} className={primaryBtn}>
                {busy === "saving" ? "Saving…" : "Save design"}
              </button>
              {dirty ? (
                <span className="text-[12px] text-[var(--ink-mute)]">Unsaved changes</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 text-[12.5px] text-[var(--ink-mute)]">
              The design is set by a regional lead or super admin.
            </p>
          )}
        </section>

        {/* Print */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-6 shadow-[var(--shadow-paper-1)]">
          <Eyebrow>Print · 打印</Eyebrow>

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-[10px] overflow-hidden border border-[var(--paper-shadow)] bg-[var(--paper-shadow)]">
            <Stat label="Paid · 已付款" value={rows ? counts.paid : null} />
            <Stat label="Printed · 已打印" value={rows ? counts.printed : null} />
            <Stat label="New · 新增" value={rows ? counts.new : null} />
            <Stat label="Changed · 变更" value={rows ? counts.changed : null} />
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => download("all", "all")}
              disabled={working || !rows || counts.paid === 0}
              className={primaryBtn}
            >
              Download all badges
            </button>
            <button
              type="button"
              onClick={() => download("changed", "changed")}
              disabled={working || !rows || counts.new + counts.changed === 0}
              className={pillBtn}
            >
              Download new &amp; changed ({rows ? counts.new + counts.changed : "–"})
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)]">
            <label htmlFor="badge-search" className="block text-[12.5px] font-medium text-[var(--ink)]">
              One person · 单人补印
            </label>
            <div className="mt-2 relative max-w-[420px]">
              <input
                id="badge-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or region ID"
                autoComplete="off"
                className="h-10 w-full px-3.5 rounded-[10px] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              />
              {matches.length > 0 ? (
                <ul className="absolute z-10 mt-1 w-full rounded-[10px] border border-[var(--paper-shadow)] bg-[var(--paper)] shadow-[0_12px_28px_-12px_rgba(15,30,60,0.35)] overflow-hidden">
                  {matches.map((r) => (
                    <li key={r.enrollment_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(r.enrollment_id);
                          setQuery("");
                        }}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--cinnabar-wash)] focus-visible:bg-[var(--cinnabar-wash)] focus-visible:outline-none active:bg-[var(--paper-deep)]"
                      >
                        <span className="truncate">{r.name || "—"}</span>
                        <span className="shrink-0 text-[11.5px] text-[var(--ink-mute)] tabular-nums">
                          {r.region_id ?? ""}{r.display_no != null ? ` · Group ${r.display_no}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {selected ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-[var(--ink)]">
                  {selected.name || "—"}{" "}
                  <span className="text-[var(--ink-mute)]">
                    {selected.region_id ?? ""}
                    {selected.display_no != null ? ` · Group ${selected.display_no}` : ""}
                    {selected.seat_no != null ? ` · Seat ${selected.seat_no}` : ""}
                    {selected.print_count > 0 ? ` · printed ${selected.print_count}×` : " · not printed yet"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => download("ids", "one", [selected.enrollment_id])}
                  disabled={working}
                  className={pillBtn}
                >
                  Download this badge
                </button>
              </div>
            ) : selectedId && rows ? (
              <p className="mt-3 text-[12.5px] text-[var(--ink-mute)]">
                That person isn&apos;t a paid attendee, so they don&apos;t get a badge.
              </p>
            ) : null}
          </div>

          <div aria-live="polite" className="mt-5 min-h-[20px] text-[12.5px]">
            {progress ? <span className="text-[var(--ink-soft)]">{progress}</span> : null}
            {!progress && error ? <span role="alert" className="text-[var(--cinnabar-deep)]">{error}</span> : null}
            {!progress && !error && notice ? <span className="text-[var(--ink-soft)]">{notice}</span> : null}
          </div>

          <ul className="mt-2 space-y-1.5 text-[12px] leading-[1.6] text-[var(--ink-mute)]">
            <li>Each page has 10 badges with cut marks. Print at 100% (Actual size) — page 1 has a 50 mm bar to check.</li>
            <li>Only paid attendees get a badge, because it carries their check-in QR.</li>
            {missingTokens > 0 ? (
              <li className="text-[var(--cinnabar-deep)]">
                {missingTokens} paid attendee{missingTokens === 1 ? "" : "s"} couldn&apos;t get a QR code and {missingTokens === 1 ? "is" : "are"} left out. Reload to retry.
              </li>
            ) : null}
            {duplicateEnrolments > 0 ? (
              <li className="text-[var(--cinnabar-deep)]">
                {duplicateEnrolments} attendee{duplicateEnrolments === 1 ? " is" : "s are"} enrolled twice in this event. They get one badge each, from their first enrollment — check the enrollments list for the extra one.
              </li>
            ) : null}
            {cjkFont === null ? (
              <li className="text-[var(--cinnabar-deep)]">
                This computer doesn&apos;t have PingFang SC or Noto Sans SC, so Chinese names will use a fallback font. Export from a Mac for the intended look.
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      {/* Preview — sticky on desktop, first on mobile */}
      <aside className="order-1 lg:order-2 lg:sticky lg:top-24 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-6 shadow-[var(--shadow-paper-1)]">
        <Eyebrow>Preview · 预览</Eyebrow>
        <div className="mt-5">
          <BadgePreview
            settings={settings}
            name={previewRow?.name || SAMPLE.name}
            token={previewRow?.token ?? SAMPLE.token}
          />
        </div>
        <p className="mt-3 text-[12px] text-[var(--ink-mute)] text-center">
          {previewRow
            ? selected
              ? `Showing ${selected.name || "selected attendee"}`
              : "Showing the first badge in print order"
            : "Showing a sample name"}
        </p>
      </aside>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
      <span className="w-4 h-px bg-current" />
      {children}
    </div>
  );
}

/** Swatch + hex box. The hex box keeps its own draft so a half-typed code
 *  never reaches the preview or the save. */
function ColorInput({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label={label}
        className="h-9 w-12 rounded-[8px] border border-[var(--paper-shadow)] bg-[var(--paper)] p-1 cursor-pointer disabled:cursor-not-allowed focus-visible:shadow-[var(--shadow-focus)]"
      />
      <input
        type="text"
        value={draft}
        disabled={disabled}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.toUpperCase();
          if (!/^#?[0-9A-F]{0,6}$/.test(v)) return;
          const withHash = v.startsWith("#") ? v : `#${v}`;
          setDraft(withHash);
          if (withHash.length === 7) onChange(withHash);
        }}
        onBlur={() => setDraft(value)}
        aria-label={`${label} hex code`}
        className="h-9 w-[100px] px-3 rounded-[8px] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] tabular-nums text-[var(--ink)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-[12.5px] font-medium text-[var(--ink)]">{label}</div>
      {hint ? <p className="mt-0.5 text-[12px] text-[var(--ink-mute)]">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[12.5px] font-medium text-[var(--ink)]">
          {label}
        </label>
        <span className="text-[12px] tabular-nums text-[var(--ink-soft)]">
          {value} {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--cinnabar)] disabled:opacity-60 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] rounded-full"
      />
    </div>
  );
}

function Segment({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.02em] font-medium transition-[background-color,color] duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed
        ${active
          ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] shadow-[0_2px_6px_rgba(37,99,235,0.25)]"
          : "text-[var(--ink-mute)] hover:text-[var(--ink)] active:text-[var(--ink)]"}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bg-[var(--paper)] px-4 py-3">
      <dt className="text-[11px] text-[var(--ink-mute)]">{label}</dt>
      <dd className="mt-1 font-display text-[24px] leading-none tabular-nums text-[var(--ink)]">
        {value ?? "–"}
      </dd>
    </div>
  );
}

const pillBtn =
  "inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] tracking-[0.02em] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] active:bg-[var(--paper-deep)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-60 disabled:cursor-not-allowed transition-[background-color,border-color,color] duration-[var(--dur-fast)]";

const primaryBtn =
  "inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.02em] font-medium text-[var(--paper-warm)] shadow-[0_2px_8px_-2px_rgba(37,99,235,0.35)] hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 disabled:cursor-not-allowed transition-[background-color,transform] duration-[var(--dur-fast)]";

const linkBtn =
  "text-[12.5px] text-[var(--ink-mute)] underline underline-offset-2 hover:text-[var(--cinnabar-deep)] active:text-[var(--ink)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] rounded disabled:opacity-60";

function explain(e: unknown): string {
  const code = e instanceof Error ? e.message : String(e);
  switch (code) {
    case "forbidden":
      return "You don't have permission to do that.";
    case "event_not_found":
      return "Event not found.";
    case "background_fetch_failed":
    case "image_load_failed":
      return "Couldn't load the design image. Reload the page and try again.";
    case "load_failed":
      return "Couldn't load attendees. Try again.";
    case "duplicate_qr_token":
      return "Two attendees share a QR code, so no PDF was made. Contact support before printing.";
    case "save_failed":
      return "Couldn't save the design. Try again.";
    default:
      return code;
  }
}
