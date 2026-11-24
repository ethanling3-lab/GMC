import "server-only";
import { writeAuditLog } from "@/lib/audit";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Field-level edit history for a participant, stored in audit_log. Biometric
// data and passport details never enter it.

const NEVER_LOGGED = new Set([
  "face_embedding",
  "face_measurements",
  "passport_info",
  "updated_at",
]);

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function logParticipantChange(args: {
  actorId: string;
  participantId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): Promise<void> {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(args.after)) {
    if (NEVER_LOGGED.has(field) || same(args.before[field], value)) continue;
    before[field] = args.before[field] ?? null;
    after[field] = value ?? null;
  }
  if (Object.keys(after).length === 0) return;
  await writeAuditLog({
    actor_id: args.actorId,
    action: "participant.fields_changed",
    entity: "participants",
    entity_id: args.participantId,
    before,
    after,
  });
}

const EVENT_LABEL: Record<string, string> = {
  "participant.family_links_changed": "Family links changed",
  "participant.conflict_pairs_changed": "Conflict pairs changed",
  "participant.face_embedding_computed": "Face match updated",
  "participant.face_embedding_failed": "Face match failed",
  "participant.facial_recognition_consent_changed": "Face recognition consent changed",
  "participant.marketing_status_changed": "WhatsApp subscription changed",
};

export type HistoryChange = { field: string; from: string; to: string };

export type HistoryEntry = {
  id: string;
  at: string;
  actor: string;
  label: string | null;
  changes: HistoryChange[];
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = Array.isArray(value)
    ? value.join(", ")
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function fieldLabel(field: string): string {
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function loadParticipantHistory(participantId: string): Promise<HistoryEntry[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("audit_log")
    .select("id, actor_id, action, before_state, after_state, created_at")
    .eq("entity", "participants")
    .eq("entity_id", participantId)
    .in("action", ["participant.fields_changed", ...Object.keys(EVENT_LABEL)])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    actor_id: string | null;
    action: string;
    before_state: Record<string, unknown> | null;
    after_state: Record<string, unknown> | null;
    created_at: string;
  }>;

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))];
  const actors = new Map<string, string>();
  await Promise.all(
    actorIds.map(async (id) => {
      const { data: staff } = await service
        .from("admins")
        .select("name_en, name_cn")
        .eq("id", id)
        .maybeSingle();
      let name = staff?.name_en || staff?.name_cn || null;
      if (!name) {
        const { data: auth } = await service.auth.admin.getUserById(id);
        name = auth?.user?.email ?? null;
      }
      actors.set(id, name ?? "Unknown staff");
    }),
  );

  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    actor: r.actor_id ? (actors.get(r.actor_id) ?? "Unknown staff") : "System",
    label: EVENT_LABEL[r.action] ?? null,
    changes:
      r.action === "participant.fields_changed"
        ? Object.keys(r.after_state ?? {}).map((field) => ({
            field: fieldLabel(field),
            from: formatValue(r.before_state?.[field]),
            to: formatValue(r.after_state?.[field]),
          }))
        : [],
  }));
}
