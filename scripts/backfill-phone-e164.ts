#!/usr/bin/env node
// Populate participants.phone_e164 from participants.phone, and report every
// row that cannot be normalised.
//
// Dry run by default — prints what WOULD change and writes nothing:
//   cd gmc-crm
//   npx tsx scripts/backfill-phone-e164.ts
//
// Apply:
//   npx tsx scripts/backfill-phone-e164.ts --apply
//
// Safe to re-run: it only touches rows whose phone_e164 differs from what the
// normaliser produces, so a second pass is a no-op. Run it again after fixing
// flagged rows by hand.
//
// Requires service-role access (RLS hides most participants otherwise). Reads
// env from process.env or .env.local / .env, same loader as the other scripts.
//
// PII: phone numbers are masked in all output (last 3 digits only) and rows
// are identified by region_id, per the project's tokenization rule. Nothing
// here should be pasted anywhere without re-checking that.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { normalizePhone, type PhoneRejectReason } from "../src/lib/whatsapp/phone";

function loadDotEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] !== undefined) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) return "***";
  return `${"*".repeat(Math.min(digits.length - 3, 12))}${digits.slice(-3)}`;
}

type Row = {
  id: string;
  region_id: string | null;
  region: string | null;
  phone: string | null;
  phone_e164: string | null;
};

async function main() {
  loadDotEnv();
  const apply = process.argv.includes("--apply");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env or .env",
    );
    process.exit(1);
  }
  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  // The dry run deliberately works BEFORE migration 052 is applied, so the
  // report can inform the decision to apply it. 42703 = column missing; fall
  // back to reading without it and treat every phone_e164 as null.
  let hasColumn = true;
  const probe = await db.from("participants").select("phone_e164").limit(1);
  if (probe.error && (probe.error as { code?: string }).code === "42703") {
    hasColumn = false;
    console.log(
      "\nNote: participants.phone_e164 does not exist yet — migration 052 has not been applied.\n" +
        "Reporting what the backfill WOULD do. --apply cannot run until the migration lands.",
    );
  }
  const columns = hasColumn
    ? "id, region_id, region, phone, phone_e164"
    : "id, region_id, region, phone";

  // Page through — the table is small today but this script outlives that.
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("participants")
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`query failed: ${error.message}`);
      process.exit(1);
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page.map((r) => ({ ...r, phone_e164: r.phone_e164 ?? null })));
    if (page.length < PAGE) break;
  }

  const updates: Array<{ id: string; phone_e164: string }> = [];
  const failures: Array<{ row: Row; reason: PhoneRejectReason; detail: string }> = [];
  let alreadyCorrect = 0;
  let noPhone = 0;
  let landline = 0;

  for (const row of rows) {
    if (!row.phone || !row.phone.trim()) {
      noPhone++;
      continue;
    }
    const res = normalizePhone(row.phone, row.region);
    if (!res.ok) {
      failures.push({ row, reason: res.reason, detail: res.detail });
      continue;
    }
    if (res.mobile === false) landline++;
    if (row.phone_e164 === res.e164) {
      alreadyCorrect++;
      continue;
    }
    updates.push({ id: row.id, phone_e164: res.e164 });
  }

  console.log(`\nparticipants scanned      ${rows.length}`);
  console.log(`  no phone on record      ${noPhone}`);
  console.log(`  phone_e164 already set  ${alreadyCorrect}`);
  console.log(`  to write                ${updates.length}`);
  console.log(`  cannot normalise        ${failures.length}`);
  if (landline > 0) {
    console.log(
      `  (${landline} normalised fine but look like landlines — WhatsApp will not reach them)`,
    );
  }

  if (failures.length > 0) {
    console.log(`\nRows needing a human — phone masked, identified by region_id:`);
    const byReason = new Map<string, typeof failures>();
    for (const f of failures) {
      const list = byReason.get(f.reason) ?? [];
      list.push(f);
      byReason.set(f.reason, list);
    }
    for (const [reason, list] of byReason) {
      console.log(`\n  ${reason} (${list.length})`);
      for (const f of list) {
        const who = f.row.region_id ?? `id:${f.row.id.slice(0, 8)}`;
        console.log(
          `    ${who.padEnd(10)} region=${(f.row.region ?? "—").padEnd(4)} ${mask(f.row.phone ?? "")}  — ${f.detail}`,
        );
      }
    }
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to write.`);
    return;
  }
  if (!hasColumn) {
    console.error(
      `\nCannot --apply: participants.phone_e164 does not exist. Apply migration 052 first.`,
    );
    process.exit(1);
  }
  if (updates.length === 0) {
    console.log(`\nNothing to write.`);
    return;
  }

  // One statement per row. The table is ~400 rows; a bulk upsert would need
  // every NOT NULL column echoed back, which risks clobbering columns this
  // script has no business touching.
  let written = 0;
  for (const u of updates) {
    const { error } = await db
      .from("participants")
      .update({ phone_e164: u.phone_e164 })
      .eq("id", u.id);
    if (error) {
      console.error(`  write failed for ${u.id.slice(0, 8)}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`\nWrote ${written} of ${updates.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
