import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminContext } from "@/lib/admin-guard";
import {
  evaluateWindow,
  describeWindow,
  WINDOW_COLUMNS,
  type ConversationWindowRow,
  type WindowChannel,
} from "./window";

// Inbox list-query helper. URL-driven filters + role-scope + q-search, mirroring
// the pattern from `src/lib/participants-query.ts` (per feedback_list_query_pattern).

// Replaces the six-value participant lifecycle filter, dropped in 053.
// "Unverified" is the one distinction the inbox actually worked with: it marks
// a thread from a number nobody has linked to a real person yet.
export type IdentityConfidence = "unverified" | "verified";

export const IDENTITY_CONFIDENCE_VALUES: readonly IdentityConfidence[] = [
  "unverified",
  "verified",
] as const;

export type InboxListFilters = {
  scope: "mine" | "unassigned" | "all";
  channel: "whatsapp" | "email" | null;
  status: "open" | "pending" | "snoozed" | "closed" | null;
  identity: IdentityConfidence | null;
  tag: string | null;
  q: string;
  admin_id: string;
};

export type ConversationListRow = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  assigned_to: string | null;
  tags: string[];
  last_message_at: string | null;
  last_message_preview: string | null;
  participant_id: string;
  ai_enabled: boolean;
  /** Inbound messages since this admin's last_read_at. 0 when fully read. */
  unread_count: number;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    region: string | null;
    identity_confidence: string;
    email: string | null;
    phone: string | null;
    language_fluency: string | null;
  } | null;
  assigned_admin: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
  } | null;
};

export function parseFilters(
  admin: AdminContext,
  sp: Record<string, string | string[] | undefined>,
): InboxListFilters {
  const scopeRaw = typeof sp.scope === "string" ? sp.scope : "mine";
  const scope: InboxListFilters["scope"] =
    scopeRaw === "unassigned" || scopeRaw === "all" ? scopeRaw : "mine";

  const channelRaw = typeof sp.channel === "string" ? sp.channel : "";
  const channel =
    channelRaw === "whatsapp" || channelRaw === "email"
      ? (channelRaw as InboxListFilters["channel"])
      : null;

  const statusRaw = typeof sp.status === "string" ? sp.status : "";
  const status =
    statusRaw === "open" ||
    statusRaw === "pending" ||
    statusRaw === "snoozed" ||
    statusRaw === "closed"
      ? (statusRaw as InboxListFilters["status"])
      : null;

  const identityRaw = typeof sp.identity === "string" ? sp.identity : "";
  const identity = (IDENTITY_CONFIDENCE_VALUES as readonly string[]).includes(identityRaw)
    ? (identityRaw as IdentityConfidence)
    : null;

  const tagRaw = (typeof sp.tag === "string" ? sp.tag : "").trim().slice(0, 40);
  const tag = /^[a-z0-9][a-z0-9-]{0,39}$/.test(tagRaw) ? tagRaw : null;

  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 120);

  return { scope, channel, status, identity, tag, q, admin_id: admin.id };
}

export async function loadConversations(
  supabase: SupabaseClient,
  filters: InboxListFilters,
): Promise<ConversationListRow[]> {
  // Participant search (q) resolved separately — two small queries beat a
  // nested-or on a foreign table (pattern from enrollments-list).
  let participantIdsForQ: string[] | null = null;
  if (filters.q) {
    const needle = `%${filters.q.replace(/[%_]/g, "\\$&")}%`;
    const { data: pRows } = await supabase
      .from("participants")
      .select("id")
      .or(
        [
          `name_en.ilike.${needle}`,
          `name_cn.ilike.${needle}`,
          `region_id.ilike.${needle}`,
          `email.ilike.${needle}`,
          `phone.ilike.${needle}`,
        ].join(","),
      )
      .limit(5000);
    participantIdsForQ = (pRows ?? []).map((r) => r.id as string);
    if (participantIdsForQ.length === 0) return [];
  }

  // Identity filter (sub-nav) resolves the same way — grab participant IDs
  // whose confidence matches, then intersect with q-results.
  let participantIdsForIdentity: string[] | null = null;
  if (filters.identity) {
    const { data: pRows } = await supabase
      .from("participants")
      .select("id")
      .eq("identity_confidence", filters.identity)
      .limit(5000);
    participantIdsForIdentity = (pRows ?? []).map((r) => r.id as string);
    if (participantIdsForIdentity.length === 0) return [];
  }

  // Intersect q + identity ID lists if both were applied.
  let participantIds: string[] | null = participantIdsForQ;
  if (participantIdsForIdentity) {
    if (participantIdsForQ) {
      const qSet = new Set(participantIdsForQ);
      participantIds = participantIdsForIdentity.filter((id) => qSet.has(id));
      if (participantIds.length === 0) return [];
    } else {
      participantIds = participantIdsForIdentity;
    }
  }

  let query = supabase
    .from("conversations")
    .select(
      "id, channel, status, subject, assigned_to, tags, last_message_at, last_message_preview, participant_id, ai_enabled, participant:participants(id, region_id, name_en, name_cn, region, identity_confidence, email, phone, language_fluency), assigned_admin:admins!conversations_assigned_to_fkey(id, name_en, name_cn)",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (filters.scope === "mine") {
    query = query.eq("assigned_to", filters.admin_id);
  } else if (filters.scope === "unassigned") {
    query = query.is("assigned_to", null);
  }
  // "all": no filter — RLS already scopes per-role visibility.

  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.tag) query = query.contains("tags", [filters.tag]);
  if (participantIds) query = query.in("participant_id", participantIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as ConversationListRow[];
  return attachUnreadCounts(supabase, rows);
}

/**
 * Merges per-admin unread counts onto conversation rows.
 *
 * `conversation_reads` and MarkReadOnMount have written this cursor since 014;
 * nothing ever read it back ("Wave 2b will drive unread badges" — Wave 2b never
 * shipped). This is that missing half.
 *
 * One RPC rather than a join because PostgREST cannot express "count child rows
 * newer than a value from a second child table" in embedded-resource syntax.
 * The RPC returns only conversations with unread > 0, so the payload tracks
 * what is unread rather than how big the inbox is.
 *
 * A failure here degrades to zeroes instead of throwing: a broken badge must
 * never take down the inbox itself. It is logged, not swallowed silently —
 * that distinction is the whole point of this phase.
 */
async function attachUnreadCounts(
  supabase: SupabaseClient,
  rows: ConversationListRow[],
): Promise<ConversationListRow[]> {
  if (rows.length === 0) return rows;

  const { data, error } = await supabase.rpc("unread_conversation_counts");
  if (error) {
    console.warn("[inbox] unread counts unavailable:", error.message);
    return rows.map((r) => ({ ...r, unread_count: 0 }));
  }

  const byId = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    conversation_id: string;
    unread_count: number;
  }>) {
    byId.set(row.conversation_id, row.unread_count);
  }

  return rows.map((r) => ({ ...r, unread_count: byId.get(r.id) ?? 0 }));
}

export async function loadStatusCounts(
  supabase: SupabaseClient,
  filters: Pick<InboxListFilters, "channel" | "admin_id">,
): Promise<{ mine: number; unassigned: number; all: number }> {
  // Three lightweight head-count queries. Channel filter carries so the
  // counts match whatever channel pill the admin has active.
  const base = () => {
    let q = supabase.from("conversations").select("id", { count: "exact", head: true });
    if (filters.channel) q = q.eq("channel", filters.channel);
    return q;
  };
  const [mine, unassigned, all] = await Promise.all([
    base().eq("assigned_to", filters.admin_id),
    base().is("assigned_to", null),
    base(),
  ]);
  return {
    mine: mine.count ?? 0,
    unassigned: unassigned.count ?? 0,
    all: all.count ?? 0,
  };
}

export async function loadChannelCounts(
  supabase: SupabaseClient,
  filters: Pick<InboxListFilters, "scope" | "admin_id">,
): Promise<{ whatsapp: number }> {
  // Channel counts respect the active scope so the sidebar reads consistently
  // with whatever scope tab is selected.
  const base = () => {
    let q = supabase.from("conversations").select("id", { count: "exact", head: true });
    if (filters.scope === "mine") q = q.eq("assigned_to", filters.admin_id);
    else if (filters.scope === "unassigned") q = q.is("assigned_to", null);
    return q;
  };
  const [wa] = await Promise.all([base().eq("channel", "whatsapp")]);
  return { whatsapp: wa.count ?? 0 };
}

export async function loadConversationDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  conversation: ConversationListRow;
  messages: ThreadMessageRow[];
  enrollments: EnrollmentSummary[];
  /**
   * Staff-facing reason the free-form composer will refuse, or null when the
   * 24h window is open. Computed here rather than in the page so the composer
   * hint and the send.ts pre-flight cannot disagree — both call evaluateWindow.
   * Returned as prose, not raw columns, so the client never has to re-derive it.
   */
  windowNotice: string | null;
} | null> {
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select(
      `id, channel, status, subject, assigned_to, tags, last_message_at, last_message_preview, participant_id, ai_enabled, ${WINDOW_COLUMNS}, participant:participants(id, region_id, name_en, name_cn, region, identity_confidence, email, phone, language_fluency), assigned_admin:admins!conversations_assigned_to_fkey(id, name_en, name_cn)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);
  if (!conv) return null;

  const { data: msgs, error: msgsErr } = await supabase
    .from("messages")
    .select(
      "id, direction, channel, sender_type, sender_admin_id, body_text, body_html, attachments, ai_tags, delivery_status, error_message, created_at, sent_at, delivered_at, read_at, sender_admin:admins!messages_sender_admin_id_fkey(id, name_en, name_cn)",
    )
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (msgsErr) throw new Error(msgsErr.message);

  const participantId = (conv as unknown as ConversationListRow).participant_id;
  const { data: enrollRows } = await supabase
    .from("enrollments")
    .select(
      "id, event_id, status, payment_status, amount_paid, created_at, event:events(id, title_en, title_cn, slug, start_date, currency, price)",
    )
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false })
    .limit(20);
  const enrollments: EnrollmentSummary[] = ((enrollRows ?? []) as unknown as RawEnrollmentRow[])
    .map((e) => ({
      id: e.id,
      event_id: e.event_id,
      event_title: e.event?.title_en || e.event?.title_cn || "",
      event_slug: e.event?.slug ?? "",
      event_start: e.event?.start_date ?? null,
      currency: e.event?.currency ?? null,
      price: e.event?.price != null ? Number(e.event.price) : null,
      status: e.status,
      payment_status: e.payment_status,
      amount_paid: e.amount_paid != null ? Number(e.amount_paid) : null,
      created_at: e.created_at,
    }));

  const windowState = evaluateWindow(
    (conv as { channel: string }).channel as WindowChannel,
    conv as unknown as ConversationWindowRow,
  );

  return {
    // unread_count is 0 by definition here: opening the thread is what marks
    // it read (MarkReadOnMount). Nothing in the detail view renders a badge.
    conversation: { ...(conv as unknown as ConversationListRow), unread_count: 0 },
    messages: (msgs ?? []) as unknown as ThreadMessageRow[],
    enrollments,
    windowNotice: describeWindow(windowState),
  };
}

export type ThreadMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  sender_type: string;
  sender_admin_id: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: Array<{
    storage_path: string | null;
    mime_type: string | null;
    filename: string | null;
    caption: string | null;
    size: number | null;
    media_id?: string;
    error?: string;
  }>;
  ai_tags: Record<string, unknown>;
  delivery_status: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  sender_admin: {
    id: string;
    name_en: string | null;
    name_cn: string | null;
  } | null;
};

export type EnrollmentSummary = {
  id: string;
  event_id: string;
  event_title: string;
  event_slug: string;
  event_start: string | null;
  currency: string | null;
  price: number | null;
  status: string;
  payment_status: string;
  amount_paid: number | null;
  created_at: string;
};

type RawEnrollmentRow = {
  id: string;
  event_id: string;
  status: string;
  payment_status: string;
  amount_paid: number | string | null;
  created_at: string;
  event: {
    id: string;
    title_en: string | null;
    title_cn: string | null;
    slug: string;
    start_date: string | null;
    currency: string | null;
    price: number | string | null;
  } | null;
};
