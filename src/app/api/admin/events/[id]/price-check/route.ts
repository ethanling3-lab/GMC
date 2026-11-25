import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadPricingParticipants, PRICING_EVENT_COLUMNS, type PricingEvent } from "@/lib/pricing/resolve-server";
import { describeBasis, resolvePrice, type PriceBasis } from "@/lib/pricing/tiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/events/[id]/price-check — re-run the price rules for every
// live enrollment and list the ones whose stored amount differs from what
// the rules give today (e.g. a programme was added or expired after they
// registered). Read-only: it only FLAGS; staff apply fixes one by one via
// PATCH /api/admin/enrollments/[id] { reprice: true, price_reason } so each
// change keeps a reason and an audit row. Super Admin only.

type EnrollmentRow = {
  id: string;
  participant_id: string;
  status: string;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  price_tier_key: string | null;
  price_basis: PriceBasis | null;
  participant: { region_id: string | null; name_cn: string | null; name_en: string | null } | null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const service = createSupabaseServiceClient();

  const { data: event, error: evErr } = await service
    .from("events")
    .select(`${PRICING_EVENT_COLUMNS}, currency`)
    .eq("id", id)
    .maybeSingle<PricingEvent & { currency: string | null }>();
  if (evErr || !event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });

  const { data: rows, error } = await service
    .from("enrollments")
    .select(
      "id, participant_id, status, amount_due, amount_paid, price_tier_key, price_basis, participant:participants(region_id, name_cn, name_en)",
    )
    .eq("event_id", id)
    .not("status", "in", "(rejected,cancelled)")
    .returns<EnrollmentRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const people = await loadPricingParticipants(event, (rows ?? []).map((r) => r.participant_id), service);
  const { data: progs } = await service.from("programmes").select("slug, name_cn").returns<Array<{ slug: string; name_cn: string }>>();
  const nameOf = new Map((progs ?? []).map((p) => [p.slug, p.name_cn]));
  const programmeName = (s: string) => nameOf.get(s) ?? s;
  const currency = event.currency ?? "SGD";

  const mismatches = [];
  let checked = 0;
  for (const r of rows ?? []) {
    checked += 1;
    // A staff override is a deliberate decision — don't flag it.
    if (r.price_basis?.rule === "override") continue;
    const now = resolvePrice(event, people.get(r.participant_id) ?? null);
    const stored = r.amount_due == null ? null : Number(r.amount_due);
    const same = stored === now.amount && (r.price_tier_key ?? null) === (now.tier_key ?? null);
    if (same) continue;
    mismatches.push({
      enrollment_id: r.id,
      region_id: r.participant?.region_id ?? null,
      name: r.participant?.name_cn || r.participant?.name_en || "—",
      status: r.status,
      amount_paid: r.amount_paid == null ? null : Number(r.amount_paid),
      stored: { amount: stored, tier_key: r.price_tier_key, why: r.price_basis ? describeBasis(r.price_basis, programmeName, currency) : "Priced before price records were kept" },
      now: { amount: now.amount, tier_key: now.tier_key, why: describeBasis(now.basis, programmeName, currency) },
    });
  }
  return NextResponse.json({ checked, currency, mismatches });
}
