import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { AiKillSwitch } from "@/components/admin/ai/AiKillSwitch";
import { describeModelPrice, MODEL_PRICING } from "@/lib/ai/pricing";

export const dynamic = "force-dynamic";

// /admin/ai — the control room, v1.
//
// Scope is deliberately narrow: the two things that had to exist before
// `conversations.ai_enabled` could default to true. Turning the AI off used to
// mean hand-written SQL run by whoever was awake, and nothing at all bounded a
// day's spend.
//
// The runs list, the per-conversation trace, and knowledge management come in
// Phase 4. This page is the safety floor, not the dashboard.

const WRITE_ROLES = ["super_admin", "regional_lead"];

export default async function AiControlPage() {
  const admin = await requireAdmin();
  const service = createSupabaseServiceClient();

  const { data: settings } = await service
    .from("ai_settings")
    .select("ai_enabled, daily_cost_cap_cents, model_tier1")
    .eq("scope", "global")
    .maybeSingle();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data: runs } = await service
    .from("ai_runs")
    .select("cost_cents, model, result")
    .gte("created_at", startOfDay.toISOString())
    .eq("task", "tier1_reply");

  const rows = (runs ?? []) as Array<{
    cost_cents: number | string | null;
    model: string | null;
    result: { status?: string; reason?: string } | null;
  }>;

  const spentTodayCents = rows.reduce((sum, r) => sum + Number(r.cost_cents ?? 0), 0);
  const repliedToday = rows.filter((r) => r.result?.status === "replied").length;
  const handoffToday = rows.filter((r) => r.result?.status === "handoff").length;
  const skippedToday = rows.filter((r) => r.result?.status === "skipped").length;

  // Two different reasons a run can have no cost, and conflating them sends
  // someone to edit a pricing table that is already correct:
  //
  //   * The model has no entry in MODEL_PRICING — a real gap. That run spent
  //     money the cap cannot see, and it will keep happening until the model
  //     is added.
  //   * The run predates the cost_cents column (migration 055). A one-time
  //     historical artefact that fixes itself as the day rolls over.
  //
  // Only the first is actionable, so only the first is surfaced as a warning.
  const unpricedRows = rows.filter(
    (r) => r.cost_cents === null && !isPricedModel(r.model),
  );
  const unpricedToday = unpricedRows.length;
  const preTrackingToday = rows.filter(
    (r) => r.cost_cents === null && isPricedModel(r.model),
  ).length;
  const unpricedModels = Array.from(
    new Set(unpricedRows.map((r) => r.model ?? "(unknown)")),
  );

  const canEdit = WRITE_ROLES.includes(admin.role);
  const modelLine = describeModelPrice(settings?.model_tier1 ?? "claude-opus-4-7");

  return (
    <div className="max-w-[860px]">
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        AI Assistant · AI 助手
      </div>
      <h1 className="mt-3 font-display text-[36px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        AI controls
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
        Stop the AI everywhere, or bound what it can spend in a day. Both take
        effect without a deploy — this page exists so neither one needs an
        engineer at the moment you need it.
      </p>

      <div className="mt-8">
        <AiKillSwitch
          aiEnabled={settings?.ai_enabled ?? false}
          dailyCostCapCents={settings?.daily_cost_cap_cents ?? null}
          spentTodayCents={spentTodayCents}
          canEdit={canEdit}
        />
      </div>

      {!canEdit ? (
        <p className="mt-3 text-[12.5px] text-[var(--ink-mute)]">
          You can see these settings but not change them. Super admins and
          regional leads can.
        </p>
      ) : null}

      {/* Today at a glance */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Replied" labelZh="已回复" value={repliedToday} />
        <Stat label="Handed off" labelZh="转人工" value={handoffToday} />
        <Stat label="Skipped" labelZh="已跳过" value={skippedToday} />
        <Stat
          label="Unpriced"
          labelZh="无价格"
          value={unpricedToday}
          tone={unpricedToday > 0 ? "warn" : "neutral"}
        />
      </div>

      {unpricedToday > 0 ? (
        <p className="mt-3 max-w-[62ch] text-[12.5px] leading-[1.6] text-[#9A3412]">
          {unpricedToday} run{unpricedToday === 1 ? "" : "s"} today used{" "}
          {unpricedModels.length === 1 ? "a model" : "models"} with no entry in
          the pricing table (
          <span className="font-mono text-[11.5px]">{unpricedModels.join(", ")}</span>
          ), so their cost is not counted against the daily cap. Add{" "}
          {unpricedModels.length === 1 ? "it" : "them"} to{" "}
          <span className="font-mono text-[11.5px]">src/lib/ai/pricing.ts</span>{" "}
          — until then the cap is under-counting real spend.
        </p>
      ) : null}

      {preTrackingToday > 0 ? (
        <p className="mt-3 max-w-[62ch] text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
          {preTrackingToday} run{preTrackingToday === 1 ? "" : "s"} today ran
          before cost tracking was switched on, so {preTrackingToday === 1 ? "it has" : "they have"}{" "}
          no recorded cost. Nothing to fix — this clears on its own tomorrow.
        </p>
      ) : null}

      {modelLine ? (
        <p className="mt-6 text-[12.5px] text-[var(--ink-mute)]">
          Tier 1 model:{" "}
          <span className="font-mono text-[11.5px] text-[var(--ink-soft)]">
            {settings?.model_tier1 ?? "claude-opus-4-7"}
          </span>{" "}
          · {modelLine}
        </p>
      ) : null}
    </div>
  );
}

/** True when the model has a price we can bill against. */
function isPricedModel(model: string | null): boolean {
  return model !== null && model in MODEL_PRICING;
}

function Stat({
  label,
  labelZh,
  value,
  tone = "neutral",
}: {
  label: string;
  labelZh: string;
  value: number;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-3.5 shadow-[var(--shadow-paper-1)]">
      <div className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label} · {labelZh}
      </div>
      <div
        className={`mt-1 font-display text-[26px] tabular-nums leading-none tracking-[-0.01em] ${
          tone === "warn" && value > 0 ? "text-[#9A3412]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
