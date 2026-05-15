import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createToken, verifyToken } from "../tokens";

// Thin wrapper around src/lib/tokens.ts for the "check_in" purpose.
//
// Wire format mirrors confirm + travel tokens: `<nonce>.<hmac>`. The token
// is stored on enrollments.qr_token (unique) and embedded in the
// participant's approval email + WhatsApp message as a public URL:
//
//   ${NEXT_PUBLIC_SITE_URL}/checkin/<token>
//
// The participant opens that URL to show the QR (PNG rendered client-side
// from the token); admin scans the QR with their phone at the venue. The
// scanner page POSTs the token to /api/admin/events/[id]/check-in.

export function mintQrToken(enrollmentId: string): string {
  return createToken("check_in", enrollmentId);
}

export function verifyQrToken(enrollmentId: string, token: string): boolean {
  return verifyToken("check_in", enrollmentId, token);
}

// Idempotent — ensures the enrollment row carries a qr_token, returning the
// effective value. Callers pass a service-role client so the UPDATE bypasses
// RLS. Mints lazily so legacy approved rows (predating M7.1) backfill on
// their next touch (resend, mark-paid, etc.) without a one-off backfill
// script.
export async function ensureQrToken(
  supabase: SupabaseClient,
  enrollmentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("qr_token")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) {
    console.warn("[ensureQrToken] read failed", enrollmentId, error.message);
    return null;
  }
  if (data?.qr_token) return data.qr_token as string;

  const token = mintQrToken(enrollmentId);
  const { error: updateErr } = await supabase
    .from("enrollments")
    .update({ qr_token: token })
    .eq("id", enrollmentId);
  if (updateErr) {
    // If a parallel approval raced and won, fetch the row again so we return
    // the persisted value rather than our discarded mint.
    const { data: refetched } = await supabase
      .from("enrollments")
      .select("qr_token")
      .eq("id", enrollmentId)
      .maybeSingle();
    return (refetched?.qr_token as string) ?? null;
  }
  return token;
}

export function buildCheckInUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/checkin/${token}`;
}
