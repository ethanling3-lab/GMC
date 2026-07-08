#!/usr/bin/env node
// One-off backfill for Migration 043 — set the FROZEN validity window on
// participants who were linked to a programme by the migration's backfill
// (programme_id set) but still have a null anchor.
//
//   programme_started_at = latest paid enrolment's paid_at (else created_at)
//   programme_expires_at = started_at + programme.validity_months  (null=never)
//
// Idempotent: only fills rows where programme_started_at IS NULL. Safe to
// re-run. Prints a summary (how many now valid vs expired) for review.
//
// Run with: npx tsx scripts/backfill-programme-anchor.ts
// Env needed: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: progs } = await db.from("programmes").select("id, validity_months");
  const validityById = new Map<string, number | null>(
    (progs ?? []).map((p) => [p.id as string, (p.validity_months as number | null) ?? null]),
  );

  const { data: parts, error } = await db
    .from("participants")
    .select("id, programme_id, created_at")
    .not("programme_id", "is", null)
    .is("programme_started_at", null);
  if (error) {
    console.error("load participants failed", error);
    process.exit(1);
  }
  const targets = parts ?? [];
  console.log(`Participants to anchor: ${targets.length}`);
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Latest paid_at per participant (one query, max in JS).
  const ids = targets.map((p) => p.id as string);
  const latestPaid = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: enrs } = await db
      .from("enrollments")
      .select("participant_id, paid_at")
      .in("participant_id", chunk)
      .not("paid_at", "is", null);
    for (const e of enrs ?? []) {
      const pid = e.participant_id as string;
      const at = e.paid_at as string;
      const prev = latestPaid.get(pid);
      if (!prev || new Date(at) > new Date(prev)) latestPaid.set(pid, at);
    }
  }

  const now = Date.now();
  let updated = 0;
  let valid = 0;
  let expired = 0;
  let neverExpires = 0;
  for (const p of targets) {
    const pid = p.id as string;
    const started = latestPaid.get(pid) ?? (p.created_at as string) ?? new Date().toISOString();
    const validity = validityById.get(p.programme_id as string) ?? null;
    const expires = validity == null ? null : addMonths(started, validity);
    const { error: upErr } = await db
      .from("participants")
      .update({ programme_started_at: started, programme_expires_at: expires })
      .eq("id", pid);
    if (upErr) {
      console.error(`update ${pid} failed`, upErr.message);
      continue;
    }
    updated++;
    if (expires == null) neverExpires++;
    else if (new Date(expires).getTime() <= now) expired++;
    else valid++;
  }

  console.log("─".repeat(50));
  console.log(`Anchored: ${updated}`);
  console.log(`  currently valid:  ${valid}`);
  console.log(`  expired (revert): ${expired}`);
  console.log(`  never expires:    ${neverExpires}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
