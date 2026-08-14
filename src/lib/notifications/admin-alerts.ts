import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Staff-facing alerts. Writes public.admin_notifications (migration 054).
//
// Distinct from src/lib/enrollment-notifications.ts, which logs
// public.notifications — that table is the participant-facing delivery log.
// These are for the people running the inbox.
//
// EVERY FUNCTION HERE IS BEST-EFFORT AND NEVER THROWS.
//
// These are called from the inbound ingest path and from the outbound send
// path. An alert failing must not fail the thing it is reporting on: losing a
// bell notification is an annoyance, losing the inbound message it describes is
// the failure this whole phase exists to prevent. Failures are logged loudly
// rather than swallowed.

export type AdminAlertKind = "new_inbound" | "ai_handoff" | "send_failed";

type NotifyInput = {
  kind: AdminAlertKind;
  conversationId: string;
  messageId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Fan out an alert to the admins who should see it.
 *
 * Routing, most specific first:
 *   1. the admin the conversation is assigned to
 *   2. else the participant's assigned CS
 *   3. else every customer_service + regional_lead admin
 *
 * Step 3 is deliberately broad. An unassigned thread from an unknown number is
 * exactly the case that went unnoticed, and narrowing the fan-out to "whoever
 * owns it" would send it to nobody — that is the bug, not the fix.
 */
export async function notifyAdmins(input: NotifyInput): Promise<void> {
  try {
    const service = createSupabaseServiceClient();

    const { data: conv } = await service
      .from("conversations")
      .select("id, assigned_to, participant_id")
      .eq("id", input.conversationId)
      .maybeSingle();
    if (!conv) return;

    const recipients = await resolveRecipients(service, {
      assignedTo: conv.assigned_to as string | null,
      participantId: conv.participant_id as string | null,
    });
    if (recipients.length === 0) return;

    // Suppress a repeat new_inbound for the same thread inside the window. A
    // burst of five WhatsApp messages is one situation, not five alerts. Only
    // new_inbound is throttled: an ai_handoff or a send_failed is a discrete
    // event and every one matters.
    if (input.kind === "new_inbound") {
      const since = new Date(Date.now() - NEW_INBOUND_DEDUPE_MS).toISOString();
      const { data: recent } = await service
        .from("admin_notifications")
        .select("id")
        .eq("conversation_id", input.conversationId)
        .eq("kind", "new_inbound")
        .gte("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) return;
    }

    const rows = recipients.map((adminId) => ({
      admin_id: adminId,
      kind: input.kind,
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      payload: input.payload ?? {},
    }));

    const { error } = await service.from("admin_notifications").insert(rows);
    if (error) {
      console.warn("[alerts] insert failed (%s): %s", input.kind, error.message);
    }
  } catch (err) {
    console.warn(
      "[alerts] notifyAdmins threw (%s): %s",
      input.kind,
      err instanceof Error ? err.message : String(err),
    );
  }
}

const NEW_INBOUND_DEDUPE_MS = 10 * 60 * 1000;

async function resolveRecipients(
  service: ReturnType<typeof createSupabaseServiceClient>,
  ctx: { assignedTo: string | null; participantId: string | null },
): Promise<string[]> {
  if (ctx.assignedTo) return [ctx.assignedTo];

  if (ctx.participantId) {
    const { data: p } = await service
      .from("participants")
      .select("assigned_cs_id")
      .eq("id", ctx.participantId)
      .maybeSingle();
    const cs = (p?.assigned_cs_id as string | null) ?? null;
    if (cs) return [cs];
  }

  // super_admin belongs here. Without it this deployment resolves to zero
  // recipients — every admin on it is a super_admin — so notifyAdmins returned
  // early and the bell never lit, which is the exact silence this phase was
  // built to remove. Caught during QA: two fresh inbound threads produced an
  // AI reply each and not one row in admin_notifications.
  const { data: admins } = await service
    .from("admins")
    .select("id")
    .in("role", ["customer_service", "regional_lead", "super_admin"]);
  return ((admins ?? []) as Array<{ id: string }>).map((a) => a.id);
}
