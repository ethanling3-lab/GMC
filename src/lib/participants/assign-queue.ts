import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// "To assign · 待分配" queue (Phase 3, Ethan 2026-11-26): people with no CS
// yet, newest first, with who brought them. When the person who brought
// them has a CS, that CS is SUGGESTED — the Super Admin checks the referral
// and confirms; nothing is assigned automatically.

export type QueueRow = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  segment: string | null;
  created_at: string;
  /** Linked referrer (a CRM person), if any. */
  referrer: { id: string; name: string; region_id: string | null; cs_id: string | null } | null;
  /** Free-text referral from the form, if any. */
  referrer_text: string | null;
  suggested_cs_id: string | null;
  /** For a child (migration 084): the parent, whose CS is suggested. */
  parent: { id: string; name: string } | null;
  /** Their latest registration, for context. */
  latest_event: string | null;
};

export async function loadAssignQueue(limit = 200): Promise<{ rows: QueueRow[]; total: number }> {
  const service = createSupabaseServiceClient();
  const { data, count } = await service
    .from("participants")
    .select("id, region_id, name_cn, name_en, phone, email, region, segment, created_at, referrer_id, referrer_name, referrer_contact, is_minor", { count: "exact" })
    .is("assigned_cs_id", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  type Row = {
    id: string; region_id: string | null; name_cn: string | null; name_en: string | null; phone: string | null; email: string | null;
    region: string | null; segment: string | null; created_at: string; referrer_id: string | null; referrer_name: string | null;
    referrer_contact: string | null; is_minor: boolean | null;
  };
  const rows = (data ?? []) as Row[];

  // A child's CS is suggested from their parent.
  // (Anyone linked as a child — also one with their own login now.)
  const childIds = rows.map((r) => r.id);
  const { data: guards } = childIds.length
    ? await service.from("participant_guardians").select("child_id, guardian_id").in("child_id", childIds)
    : { data: [] as Array<{ child_id: string; guardian_id: string }> };
  const parentOf = new Map<string, string>();
  for (const g of guards ?? []) if (!parentOf.has(g.child_id)) parentOf.set(g.child_id, g.guardian_id);

  const refIds = [...new Set([...rows.map((r) => r.referrer_id), ...parentOf.values()].filter(Boolean))] as string[];
  const ids = rows.map((r) => r.id);
  const [{ data: refs }, { data: enrs }] = await Promise.all([
    refIds.length
      ? service.from("participants").select("id, name_cn, name_en, region_id, assigned_cs_id").in("id", refIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name_cn: string | null; name_en: string | null; region_id: string | null; assigned_cs_id: string | null }> }),
    ids.length
      ? service.from("enrollments").select("participant_id, created_at, events(title_cn, title_en)").in("participant_id", ids).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const refById = new Map((refs ?? []).map((r) => [r.id, r]));
  const latest = new Map<string, string>();
  for (const e of (enrs ?? []) as Array<{ participant_id: string; events: { title_cn: string | null; title_en: string | null } | null }>) {
    if (!latest.has(e.participant_id) && e.events) latest.set(e.participant_id, e.events.title_cn || e.events.title_en || "");
  }

  return {
    total: count ?? rows.length,
    rows: rows.map((r) => {
      const ref = r.referrer_id ? refById.get(r.referrer_id) : undefined;
      const par = parentOf.has(r.id) ? refById.get(parentOf.get(r.id)!) : undefined;
      const text = [r.referrer_name, r.referrer_contact].filter(Boolean).join(" · ") || null;
      return {
        id: r.id,
        region_id: r.region_id,
        name_cn: r.name_cn,
        name_en: r.name_en,
        phone: r.phone,
        email: r.email,
        region: r.region,
        segment: r.segment,
        created_at: r.created_at,
        referrer: ref
          ? { id: ref.id, name: ref.name_cn || ref.name_en || "—", region_id: ref.region_id, cs_id: ref.assigned_cs_id }
          : null,
        referrer_text: text,
        suggested_cs_id: par?.assigned_cs_id ?? ref?.assigned_cs_id ?? null,
        parent: par ? { id: par.id, name: par.name_cn || par.name_en || "—" } : null,
        latest_event: latest.get(r.id) ?? null,
      };
    }),
  };
}

/** How many people still need a CS (for the badge on the Participants page). */
export async function countUnassigned(): Promise<number> {
  const { count } = await createSupabaseServiceClient()
    .from("participants")
    .select("id", { count: "exact", head: true })
    .is("assigned_cs_id", null)
    .is("archived_at", null);
  return count ?? 0;
}
