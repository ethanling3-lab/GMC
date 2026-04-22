import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Typeahead for manual reconciliation. Used by the review UI when the
// auto-matcher didn't land on the right enrolment and the admin needs to
// search by name / region_id / email / phone to pick the correct target.
//
// Scope: returns enrolments in status approved + paid (the plausible set for
// a bank inflow). Rejected/cancelled are excluded.

export async function GET(req: Request) {
  const auth = await requireFinanceAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const supabase = await createSupabaseServerClient();
  const needle = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const { data: pRows, error: pErr } = await supabase
    .from("participants")
    .select("id, region_id, name_en, name_cn, email, phone, region")
    .or(
      [
        `name_en.ilike.${needle}`,
        `name_cn.ilike.${needle}`,
        `region_id.ilike.${needle}`,
        `email.ilike.${needle}`,
        `phone.ilike.${needle}`,
      ].join(","),
    )
    .limit(25);
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const participantIds = (pRows ?? []).map((r) => r.id as string);
  if (participantIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const { data: eRows, error: eErr } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, participant_id, status, payment_status, amount_paid, paid_at, event:events(id, title_en, title_cn, currency, price, start_date)",
    )
    .in("participant_id", participantIds)
    .in("status", ["approved", "paid"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (eErr) {
    return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  const pById = new Map(
    (pRows ?? []).map((r) => [r.id as string, r]),
  );

  type EnrollmentRow = {
    id: string;
    event_id: string;
    participant_id: string;
    status: string;
    payment_status: string;
    amount_paid: number | string | null;
    paid_at: string | null;
    event: {
      id: string;
      title_en: string | null;
      title_cn: string | null;
      currency: string | null;
      price: number | string | null;
      start_date: string | null;
    } | null;
  };

  const results = ((eRows ?? []) as unknown as EnrollmentRow[]).map((e) => {
    const p = pById.get(e.participant_id);
    return {
      enrollment_id: e.id,
      event_id: e.event_id,
      event_title: e.event?.title_en || e.event?.title_cn || "",
      event_date: e.event?.start_date ?? null,
      currency: e.event?.currency ?? null,
      price: e.event?.price != null ? Number(e.event.price) : null,
      status: e.status,
      payment_status: e.payment_status,
      amount_paid: e.amount_paid != null ? Number(e.amount_paid) : null,
      paid_at: e.paid_at,
      participant_id: e.participant_id,
      region_id: (p as { region_id: string | null } | undefined)?.region_id ?? null,
      name_en: (p as { name_en: string | null } | undefined)?.name_en ?? null,
      name_cn: (p as { name_cn: string | null } | undefined)?.name_cn ?? null,
      region: (p as { region: string | null } | undefined)?.region ?? null,
      email: (p as { email: string | null } | undefined)?.email ?? null,
      phone: (p as { phone: string | null } | undefined)?.phone ?? null,
    };
  });

  return NextResponse.json({ results });
}
