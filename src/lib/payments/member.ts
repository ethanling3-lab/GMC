import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { sgDay } from "@/lib/pricing/tiers";
import { loadPurchasesForParticipant } from "./ledger";
import { rowStatuses, type RowStatus } from "./standing";
import type { PaymentMethod, StandingState } from "./types";

// What a member sees about their own programme purchases on /me/payments
// (Phase 2, 2026-11-26). Staff-only details — who recorded a payment,
// internal notes, voided payments, cancel reasons — never leave the server.

export type MemberPurchase = {
  id: string;
  title: string;
  programme_name: string | null;
  registered_on: string;
  total: number;
  paid: number;
  balance: number;
  overdue: number;
  state: StandingState;
  rows: RowStatus[];
  payments: Array<{ paid_on: string; amount_sgd: number; currency: "SGD" | "MYR"; amount: number; method: PaymentMethod }>;
};

export async function loadMemberPurchases(participantId: string): Promise<MemberPurchase[]> {
  const views = await loadPurchasesForParticipant(createSupabaseServiceClient(), participantId);
  const today = sgDay();
  return views
    .filter((v) => v.status !== "cancelled")
    .map((v) => ({
      id: v.id,
      title: v.title,
      programme_name: v.programme_name,
      registered_on: v.registered_on,
      total: v.standing.total,
      paid: v.standing.paid,
      balance: v.standing.balance,
      overdue: v.standing.behind,
      state: v.standing.state,
      rows: rowStatuses(v.schedule, v.standing.paid, today),
      payments: v.payments
        .filter((p) => !p.voided_at)
        .map((p) => ({ paid_on: p.paid_on, amount_sgd: p.amount_sgd, currency: p.currency, amount: p.amount, method: p.method })),
    }));
}
