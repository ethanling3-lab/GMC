import "server-only";
import { createSupabaseServiceClient } from "./supabase";

// Non-blocking audit-log writer. Every admin action that mutates state should
// call this *after* the primary mutation has succeeded. A failed audit write
// is logged to stderr but never propagates — the audit table must never be
// able to break the product flow.
//
// The `audit_log` table has columns (actor_id, action, entity, entity_id,
// before_state, after_state, metadata, created_at). See migration 001.

export type AuditAction =
  | "enrollment.approve"
  | "enrollment.reject"
  | "enrollment.cancel"
  | "enrollment.mark_paid"
  | "enrollment.mark_unpaid"
  | "enrollment.bulk_approve"
  | "enrollment.bulk_reject"
  | "enrollment.bulk_cancel"
  | "enrollment.bulk_mark_paid"
  | "enrollment.capacity_override"
  | "enrollment.import_row"
  | "enrollment.update_amount"
  | "enrollment.created_from_admin"
  | "enrollment.notification_resent"
  | "enrollment.transfer_slip_uploaded"
  | "enrollment.checkout_started"
  | "enrollment.webhook_paid"
  | "enrollment.webhook_failed"
  | "enrollment.webhook_refunded"
  | "enrollment.refund_manual"
  | "finance.bank_import_created"
  | "finance.bank_txn_confirmed"
  | "finance.bank_txn_ignored"
  | "finance.bank_txn_rematched"
  | "finance.bank_import_deleted"
  | "inbox.participant_autocreated"
  | "inbox.identifier_linked_existing"
  | "inbox.lead_merged"
  | "inbox.message_received"
  | "inbox.message_sent"
  | "inbox.template_sent"
  | "inbox.conversation_assigned"
  | "inbox.conversation_status_changed"
  | "inbox.flight_info_extracted"
  | "inbox.flight_info_confirmed"
  | "transfer_list.generated"
  | "transfer_list.finalized";

export type WriteAuditLog = {
  actor_id: string | null;
  action: AuditAction;
  entity: string;
  entity_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(entry: WriteAuditLog): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("audit_log").insert({
      actor_id: entry.actor_id,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entity_id,
      before_state: entry.before ?? null,
      after_state: entry.after ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) {
      console.warn("[audit] insert failed", error.code, error.message);
    }
  } catch (err) {
    console.warn("[audit] unexpected error", err);
  }
}

// Convenience batch writer — used by the bulk route.
export async function writeAuditLogBatch(
  entries: WriteAuditLog[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("audit_log").insert(
      entries.map((e) => ({
        actor_id: e.actor_id,
        action: e.action,
        entity: e.entity,
        entity_id: e.entity_id,
        before_state: e.before ?? null,
        after_state: e.after ?? null,
        metadata: e.metadata ?? {},
      })),
    );
    if (error) {
      console.warn("[audit] batch insert failed", error.code, error.message);
    }
  } catch (err) {
    console.warn("[audit] unexpected error", err);
  }
}
