import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminContext } from "@/lib/admin-guard";

// Inbox list-query helper. URL-driven filters + role-scope + q-search, mirroring
// the pattern from `src/lib/participants-query.ts` (per feedback_list_query_pattern).

export type InboxListFilters = {
  scope: "mine" | "unassigned" | "all";
  channel: "whatsapp" | "line" | "email" | null;
  status: "open" | "pending" | "snoozed" | "closed" | null;
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
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
    region: string | null;
    status: string;
    email: string | null;
    phone: string | null;
    language: string | null;
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
    channelRaw === "whatsapp" || channelRaw === "line" || channelRaw === "email"
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

  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 120);

  return { scope, channel, status, q, admin_id: admin.id };
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

  let query = supabase
    .from("conversations")
    .select(
      "id, channel, status, subject, assigned_to, tags, last_message_at, last_message_preview, participant_id, ai_enabled, participant:participants(id, region_id, name_en, name_cn, region, status, email, phone, language), assigned_admin:admins!conversations_assigned_to_fkey(id, name_en, name_cn)",
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
  if (participantIdsForQ) query = query.in("participant_id", participantIdsForQ);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ConversationListRow[];
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

export async function loadConversationDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  conversation: ConversationListRow;
  messages: ThreadMessageRow[];
  enrollments: EnrollmentSummary[];
} | null> {
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select(
      "id, channel, status, subject, assigned_to, tags, last_message_at, last_message_preview, participant_id, ai_enabled, participant:participants(id, region_id, name_en, name_cn, region, status, email, phone, language), assigned_admin:admins!conversations_assigned_to_fkey(id, name_en, name_cn)",
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

  return {
    conversation: conv as unknown as ConversationListRow,
    messages: (msgs ?? []) as unknown as ThreadMessageRow[],
    enrollments,
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
