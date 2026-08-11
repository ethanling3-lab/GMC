#!/usr/bin/env node
// Diff the templates the CODE sends against the templates Meta has APPROVED.
//
//   cd gmc-crm && npm run check:templates
//
// This exact diff is how two silent production failures were found:
//   - every `gmc_*` template is approved as `en`, while the code asked Meta
//     for `en_US`. Meta matches language exactly, so 100% of English sends
//     failed with 132001 and were logged as a generic provider error.
//   - `gmc_confirm_registration` and all four `gmc_enrollment_rejected_*`
//     templates do not exist on the WABA at all, so the first message a new
//     registrant should receive has never been sendable.
//
// Neither shows up in a build, a typecheck, or a unit test — the mismatch
// only exists between this repo and an account you can't see from here. Run
// it after creating templates, after the test-WABA → production-WABA clone,
// and before any cutover.
//
// Reads WHATSAPP_WABA_ID + WHATSAPP_ACCESS_TOKEN from env or .env.local/.env.
// Exits non-zero if anything the code sends is missing or unapproved.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Comments are stripped before scanning, so a template merely DISCUSSED in a
 * comment isn't reported as a missing send. `gmc_event_reminder_48h` is
 * exactly that case — notify-reminder.ts names it in a header comment
 * explaining why WhatsApp reminders are disabled until it's approved. It is
 * planned, not broken, and conflating the two turns this check into noise.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function scanNames(text: string, into: Map<string, string[]>, path: string) {
  for (const m of text.matchAll(/["'`](gmc_[a-z0-9_]+)["'`]/g)) {
    const name = m[1];
    // `gmc_locale` is the locale cookie, not a WhatsApp template.
    if (name === "gmc_locale") continue;
    const hits = into.get(name) ?? [];
    if (!hits.includes(path)) hits.push(path);
    into.set(name, hits);
  }
}

/** `sent` = referenced in live code. `planned` = named only in a comment. */
function templateNamesInCode(
  dir: string,
  sent = new Map<string, string[]>(),
  planned = new Map<string, string[]>(),
): { sent: Map<string, string[]>; planned: Map<string, string[]> } {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      templateNamesInCode(path, sent, planned);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const text = readFileSync(path, "utf8");
    const code = stripComments(text);
    scanNames(code, sent, path);
    const commentOnly = new Map<string, string[]>();
    scanNames(text, commentOnly, path);
    for (const [name, paths] of commentOnly) {
      if (!sent.has(name)) planned.set(name, paths);
    }
  }
  return { sent, planned };
}

// The rejection templates are built by concatenation
// (`gmc_enrollment_rejected_${reason}`), so the literal never appears in
// source. Expand the known reasons explicitly rather than pretending the
// regex above found them.
const DYNAMIC_TEMPLATES: Record<string, string[]> = {
  "gmc_enrollment_rejected_": [
    "gmc_enrollment_rejected_no_seats",
    "gmc_enrollment_rejected_duplicate",
    "gmc_enrollment_rejected_unsuitable",
    "gmc_enrollment_rejected_other",
  ],
};

type MetaRow = { name?: string; language?: string; status?: string; category?: string };

async function fetchTemplates(): Promise<MetaRow[]> {
  const waba = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!waba || !token) {
    console.error("Missing WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN.");
    process.exit(1);
  }
  const version = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v22.0";
  const rows: MetaRow[] = [];
  let url:
    | string
    | undefined = `https://graph.facebook.com/${version}/${waba}/message_templates?fields=name,language,status,category&limit=100`;
  while (url) {
    const res: Response = await fetch(`${url}&access_token=${token}`);
    const json = (await res.json()) as {
      data?: MetaRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      console.error(`Meta error: ${json.error?.message ?? res.status}`);
      process.exit(1);
    }
    rows.push(...(json.data ?? []));
    // `next` already carries its own access_token; strip ours to avoid a dupe.
    url = json.paging?.next?.replace(/&access_token=[^&]*/, "");
  }
  return rows;
}

async function main() {
  loadDotEnv();

  const { sent: inCode, planned } = templateNamesInCode("src");
  for (const [prefix, expanded] of Object.entries(DYNAMIC_TEMPLATES)) {
    const source = [...inCode.keys()].find((n) => n.startsWith(prefix));
    for (const name of expanded) {
      if (!inCode.has(name)) inCode.set(name, source ? inCode.get(source)! : ["(built dynamically)"]);
    }
  }

  const rows = await fetchTemplates();
  const approved = new Map<string, string[]>();
  const unapproved = new Map<string, string[]>();
  // (name, language) → category, for the UTILITY check below.
  const categories = new Map<string, string>();
  for (const r of rows) {
    if (!r.name) continue;
    const target = (r.status ?? "").toUpperCase() === "APPROVED" ? approved : unapproved;
    const langs = target.get(r.name) ?? [];
    langs.push(`${r.language ?? "?"}${target === unapproved ? ` (${r.status})` : ""}`);
    target.set(r.name, langs);
    categories.set(`${r.name}:${r.language}`, (r.category ?? "?").toUpperCase());
  }

  console.log(`\nTemplates referenced in src/: ${inCode.size}`);
  console.log(`Templates approved on the WABA: ${approved.size}\n`);

  let missing = 0;
  for (const name of [...inCode.keys()].sort()) {
    const langs = approved.get(name);
    if (!langs) {
      missing++;
      const also = unapproved.get(name);
      console.log(`  MISSING   ${name}${also ? `  — exists but ${also.join(", ")}` : ""}`);
      continue;
    }
    console.log(`  ok        ${name}  [${langs.sort().join(", ")}]`);
  }

  if (planned.size > 0) {
    console.log(`\nNamed in comments only — planned, not sent yet:`);
    for (const n of [...planned.keys()].sort()) {
      console.log(`  - ${n}${approved.has(n) ? "  (already approved)" : ""}`);
    }
  }

  // Category check. Every message this system sends is transactional — a
  // registration confirmation, an approval, a receipt. Those must be UTILITY.
  //
  // A MARKETING template is subject to Meta's per-user frequency cap (131049)
  // and marketing opt-out (131050), so a participant who opted out of
  // marketing, or who Meta decides has had enough promo this week, silently
  // stops receiving their own payment link. Marketing also costs more per
  // conversation. Category is chosen at creation and is easy to get wrong,
  // because Meta auto-classifies and its guess is not always right.
  const miscategorised: string[] = [];
  for (const name of inCode.keys()) {
    for (const lang of approved.get(name) ?? []) {
      const cat = categories.get(`${name}:${lang}`);
      if (cat && cat !== "UTILITY") miscategorised.push(`${name} [${lang}] is ${cat}`);
    }
  }
  if (miscategorised.length > 0) {
    console.log(`\nWRONG CATEGORY — these are transactional and must be UTILITY:`);
    for (const m of miscategorised) console.log(`  ! ${m}`);
    console.log(
      `    A MARKETING template can be blocked by opt-out (131050) or Meta's`,
    );
    console.log(
      `    frequency cap (131049), so the participant never gets their own`,
    );
    console.log(`    approval or receipt. Request a category change in Meta.`);
  }

  // Approved templates the code never sends. Not an error — they may be used
  // by staff from the composer — but worth seeing.
  const unused = [...approved.keys()].filter((n) => n.startsWith("gmc_") && !inCode.has(n));
  if (unused.length > 0) {
    console.log(`\nApproved but not referenced in code (composer-only?):`);
    for (const n of unused.sort()) console.log(`  - ${n}  [${approved.get(n)!.sort().join(", ")}]`);
  }

  // The language trap: our internal key is en_US, Meta's may be plain `en`.
  const enOnly = [...approved.entries()].filter(
    ([n, l]) => n.startsWith("gmc_") && l.includes("en") && !l.includes("en_US"),
  );
  if (enOnly.length > 0) {
    console.log(
      `\nNote: ${enOnly.length} template(s) are approved as 'en', not 'en_US'.`,
    );
    console.log(
      `      That is fine — resolveMetaLanguage() sends Meta's own code. It is`,
    );
    console.log(
      `      only a problem if something hardcodes 'en_US' on the wire again.`,
    );
  }

  const summary: string[] = [];
  if (missing > 0) summary.push(`${missing} missing or unapproved`);
  if (miscategorised.length > 0) summary.push(`${miscategorised.length} wrongly categorised`);
  if (summary.length > 0) {
    console.log(`\n${summary.join(", ")}. Both block delivery — fix in Meta, not in code.`);
    process.exit(1);
  }
  console.log(`\nAll referenced templates exist, are approved, and are UTILITY.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
