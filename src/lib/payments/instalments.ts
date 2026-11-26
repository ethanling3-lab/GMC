import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase";
import { sgDay } from "@/lib/pricing/tiers";
import { hydratePurchases, PURCHASE_COLS } from "./ledger";
import type { PurchaseView, StandingState } from "./types";

// Finance → Instalments (Phase 2, 2026-11-26). Lists programme purchases
// with their standing. CS see only their own customers.

type Service = ReturnType<typeof createSupabaseServiceClient>;

export type InstalmentFilters = {
  view: "chase" | "active" | "completed" | "cancelled";
  programme?: string;
  state?: StandingState;
  cs?: string;
  q?: string;
};

export function parseInstalmentFilters(sp: Record<string, string | string[] | undefined>): InstalmentFilters {
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const view = get("view");
  const state = get("state");
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    view: view === "active" || view === "completed" || view === "cancelled" ? view : "chase",
    programme: uuid(get("programme")),
    state: state === "unpaid" || state === "partial" || state === "behind" || state === "complete" ? state : undefined,
    cs: get("cs") === "none" ? "none" : uuid(get("cs")),
    q: get("q")?.slice(0, 80),
  };
}

export type InstalmentRow = PurchaseView & {
  person: { id: string; name: string; region_id: string | null; phone: string | null; cs_id: string | null; cs_name: string | null };
  /** Next unpaid row falls due within 7 days (today included). */
  due_soon: boolean;
};

export async function loadInstalments(
  service: Service,
  f: InstalmentFilters,
  scope: { csId: string | null },
): Promise<InstalmentRow[]> {
  let q = service.from("programme_purchases").select(PURCHASE_COLS).order("registered_on", { ascending: false }).limit(2000);
  const status = f.view === "chase" ? "active" : f.view;
  q = q.eq("status", status);
  if (f.programme) q = q.eq("programme_id", f.programme);

  // People first when the list is narrowed by person (CS scope, search, CS filter).
  let personIds: string[] | null = null;
  if (scope.csId || f.cs || f.q) {
    let pq = service.from("participants").select("id").limit(5000);
    if (scope.csId) pq = pq.eq("assigned_cs_id", scope.csId);
    if (f.cs === "none") pq = pq.is("assigned_cs_id", null);
    else if (f.cs) pq = pq.eq("assigned_cs_id", f.cs);
    if (f.q) {
      const needle = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
      pq = pq.or([`name_en.ilike.${needle}`, `name_cn.ilike.${needle}`, `region_id.ilike.${needle}`, `phone.ilike.${needle}`].join(","));
    }
    const { data } = await pq;
    personIds = (data ?? []).map((r) => r.id as string);
    if (personIds.length === 0) return [];
    q = q.in("participant_id", personIds);
  }

  const { data } = await q;
  const views = await hydratePurchases(service, (data ?? []) as unknown as Parameters<typeof hydratePurchases>[1]);
  if (views.length === 0) return [];

  const ids = [...new Set(views.map((v) => v.participant_id))];
  const { data: people } = await service.from("participants").select("id, name_cn, name_en, region_id, phone, assigned_cs_id").in("id", ids);
  const csIds = [...new Set((people ?? []).map((p) => p.assigned_cs_id).filter(Boolean))] as string[];
  const { data: admins } = csIds.length
    ? await service.from("admins").select("id, name_cn, name_en").in("id", csIds)
    : { data: [] as Array<{ id: string; name_cn: string | null; name_en: string | null }> };
  const csName = new Map((admins ?? []).map((a) => [a.id, a.name_cn || a.name_en || "CS"]));
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  const today = sgDay();
  const weekOut = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10);

  let rows: InstalmentRow[] = views.map((v) => {
    const p = byId.get(v.participant_id);
    const due = v.standing.next?.due_on ?? null;
    return {
      ...v,
      person: {
        id: v.participant_id,
        name: p ? p.name_cn || p.name_en || "—" : "—",
        region_id: p?.region_id ?? null,
        phone: p?.phone ?? null,
        cs_id: p?.assigned_cs_id ?? null,
        cs_name: p?.assigned_cs_id ? csName.get(p.assigned_cs_id) ?? null : null,
      },
      due_soon: Boolean(due && due >= today && due <= weekOut),
    };
  });

  if (f.view === "chase") rows = rows.filter((r) => r.standing.state === "behind" || r.due_soon);
  if (f.state) rows = rows.filter((r) => r.standing.state === f.state);

  // Most urgent first: behind (largest), then soonest due, then newest.
  rows.sort((a, b) => {
    if (b.standing.behind !== a.standing.behind) return b.standing.behind - a.standing.behind;
    const ad = a.standing.next?.due_on ?? "9999";
    const bd = b.standing.next?.due_on ?? "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.registered_on < b.registered_on ? 1 : -1;
  });
  return rows;
}
