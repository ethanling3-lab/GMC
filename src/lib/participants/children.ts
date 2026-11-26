import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Children · 子女 (migration 084). A child is a participant with no own
// email / phone / login, linked to a parent in participant_guardians.
// Parents register them from /me; staff add them in the admin.

type Service = ReturnType<typeof createSupabaseServiceClient>;

export type ChildRow = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  birth_date: string | null;
  gender: string | null;
};

export type ChildInput = {
  name_cn: string;
  name_en?: string | null;
  birth_date: string; // YYYY-MM-DD
  gender?: string | null;
};

const CHILD_COLS = "id, region_id, name_cn, name_en, birth_date, gender";

export async function childrenOf(guardianId: string, service: Service = createSupabaseServiceClient()): Promise<ChildRow[]> {
  const { data, error } = await service
    .from("participant_guardians")
    .select(`child:participants!participant_guardians_child_id_fkey(${CHILD_COLS})`)
    .eq("guardian_id", guardianId)
    .order("created_at");
  if (error) {
    if (error.code === "42P01") return []; // migration 084 not run yet
    throw new Error(`children: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => (r as unknown as { child: ChildRow | null }).child)
    .filter((c): c is ChildRow => !!c);
}

export async function guardiansOf(
  childId: string,
  service: Service = createSupabaseServiceClient(),
): Promise<Array<{ id: string; region_id: string | null; name_cn: string | null; name_en: string | null; email: string | null; phone: string | null }>> {
  const { data, error } = await service
    .from("participant_guardians")
    .select("guardian:participants!participant_guardians_guardian_id_fkey(id, region_id, name_cn, name_en, email, phone)")
    .eq("child_id", childId)
    .order("created_at");
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`guardians: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => (r as unknown as { guardian: { id: string; region_id: string | null; name_cn: string | null; name_en: string | null; email: string | null; phone: string | null } | null }).guardian)
    .filter((g): g is NonNullable<typeof g> => !!g);
}

/** Is `childId` one of `guardianId`'s children? */
export async function isChildOf(guardianId: string, childId: string, service: Service = createSupabaseServiceClient()): Promise<boolean> {
  const { data } = await service
    .from("participant_guardians")
    .select("id")
    .eq("guardian_id", guardianId)
    .eq("child_id", childId)
    .maybeSingle();
  return !!data;
}

function sameName(a: string | null, b: string) {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Add a child for a parent, or return the existing one: a child of THIS
 * parent with the same Chinese name and birth date is the same child.
 */
export async function findOrCreateChild(
  guardianId: string,
  input: ChildInput,
  opts: { adminId?: string | null; service?: Service } = {},
): Promise<{ child: ChildRow; created: boolean }> {
  const service = opts.service ?? createSupabaseServiceClient();
  const name = input.name_cn.trim();
  const existing = (await childrenOf(guardianId, service)).find(
    (c) => sameName(c.name_cn, name) && c.birth_date === input.birth_date,
  );
  if (existing) return { child: existing, created: false };

  const { data: parent } = await service
    .from("participants")
    .select("region, language_fluency, listening_language, spoken_languages")
    .eq("id", guardianId)
    .maybeSingle<{ region: string | null; language_fluency: string | null; listening_language: string | null; spoken_languages: string[] | null }>();

  const { data: child, error } = await service
    .from("participants")
    .insert({
      name_cn: name,
      name_en: input.name_en?.trim() || null,
      birth_date: input.birth_date,
      gender: input.gender || null,
      is_minor: true,
      // Only a signed-in parent or staff can add a child, so they're vouched for.
      identity_confidence: "verified",
      email: null,
      phone: null,
      region: parent?.region ?? null,
      language_fluency: parent?.language_fluency ?? null,
      listening_language: parent?.listening_language ?? "zh",
      spoken_languages: parent?.spoken_languages ?? ["zh"],
    })
    .select(CHILD_COLS)
    .single<ChildRow>();
  if (error || !child) throw new Error(`add child: ${error?.message ?? "unknown"}`);

  await linkGuardian(guardianId, child.id, { adminId: opts.adminId ?? null, service });
  return { child, created: true };
}

/** Link an existing profile as a child; also marks them a family pair so
 *  grouping keeps them apart, and flags them as parent-managed. */
export async function linkGuardian(
  guardianId: string,
  childId: string,
  opts: { adminId?: string | null; service?: Service } = {},
): Promise<void> {
  if (guardianId === childId) throw new Error("A person can't be their own child.");
  const service = opts.service ?? createSupabaseServiceClient();
  const { error } = await service
    .from("participant_guardians")
    .upsert({ guardian_id: guardianId, child_id: childId, created_by: opts.adminId ?? null }, { onConflict: "child_id,guardian_id", ignoreDuplicates: true });
  if (error) throw new Error(`link child: ${error.message}`);
  // Parent-managed only while they have no contact of their own (a child who
  // was given their own login stays linked but manages themselves).
  await service.from("participants").update({ is_minor: true }).eq("id", childId).is("email", null).is("phone", null);
  const [a, b] = guardianId < childId ? [guardianId, childId] : [childId, guardianId];
  await service.from("participant_family_links").upsert({ a_id: a, b_id: b, created_by: opts.adminId ?? null }, { onConflict: "a_id,b_id", ignoreDuplicates: true });
}

export async function unlinkGuardian(guardianId: string, childId: string, service: Service = createSupabaseServiceClient()): Promise<void> {
  await service.from("participant_guardians").delete().eq("guardian_id", guardianId).eq("child_id", childId);
  const { count } = await service.from("participant_guardians").select("id", { count: "exact", head: true }).eq("child_id", childId);
  if (!count) await service.from("participants").update({ is_minor: false }).eq("id", childId);
}

/**
 * Give a child their own email (and optional phone) so they can have their own
 * login. They stay linked to the parent, but stop being parent-managed: their
 * messages now go to them. The set-password link is sent by the caller.
 */
export async function giveChildOwnContact(
  childId: string,
  input: { email: string; phone?: string | null },
  service: Service = createSupabaseServiceClient(),
): Promise<{ ok: true } | { ok: false; reason: "not_a_child" | "email_taken" | "has_login"; detail: string }> {
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;

  const { data: child } = await service
    .from("participants")
    .select("id, auth_user_id")
    .eq("id", childId)
    .maybeSingle<{ id: string; auth_user_id: string | null }>();
  const { count: parents } = await service
    .from("participant_guardians")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId);
  if (!child || !parents) return { ok: false, reason: "not_a_child", detail: "This profile isn't linked to a parent." };
  if (child.auth_user_id) return { ok: false, reason: "has_login", detail: "This profile already has its own login." };

  const { data: clash } = await service
    .from("participants")
    .select("id, name_cn, name_en, region_id")
    .ilike("email", email)
    .neq("id", childId)
    .limit(1)
    .maybeSingle<{ id: string; name_cn: string | null; name_en: string | null; region_id: string | null }>();
  if (clash) {
    const who = clash.name_cn || clash.name_en || clash.region_id || "another person";
    return { ok: false, reason: "email_taken", detail: `${email} already belongs to ${who}. Each person needs their own email.` };
  }

  const { error } = await service
    .from("participants")
    .update({ email, phone, is_minor: false })
    .eq("id", childId);
  if (error) throw new Error(`own login: ${error.message}`);
  return { ok: true };
}

/**
 * Where messages about this person go. A child with no own email / phone
 * uses their first parent's contact. Returns the participant unchanged
 * when they have their own contact (or no parent).
 */
export async function withGuardianContact<
  P extends { id: string; email: string | null; phone: string | null; region: string | null; language_fluency: string | null },
>(p: P, service: Service = createSupabaseServiceClient()): Promise<P & { via_guardian?: { id: string; name: string } }> {
  if (p.email || p.phone) return p;
  const { data } = await service
    .from("participant_guardians")
    .select("guardian:participants!participant_guardians_guardian_id_fkey(id, name_cn, name_en, email, phone, region, language_fluency)")
    .eq("child_id", p.id)
    .order("created_at");
  type G = { id: string; name_cn: string | null; name_en: string | null; email: string | null; phone: string | null; region: string | null; language_fluency: string | null };
  const g = (data ?? []).map((r) => (r as unknown as { guardian: G | null }).guardian).find((x) => x && (x.email || x.phone));
  if (!g) return p;
  return {
    ...p,
    email: g.email,
    phone: g.phone,
    region: p.region ?? g.region,
    language_fluency: p.language_fluency ?? g.language_fluency,
    via_guardian: { id: g.id, name: g.name_cn || g.name_en || "parent" },
  };
}
