#!/usr/bin/env node
// One-shot helper — clones approved WhatsApp message templates from a source
// WABA to a target WABA via Meta's Graph API. Designed for the test-WABA →
// official-WABA switchover: re-creating the templates by hand in Meta's UI is
// slow, and Template Library doesn't exist in every region. This hits the
// `POST /{WABA_ID}/message_templates` endpoint directly with the exact body
// components Meta approved on the source.
//
// Copied templates re-enter Meta's approval queue on the target WABA. Utility
// templates usually approve in minutes; Marketing + Authentication take longer.
//
// -----------------------------------------------------------------------------
// Usage
// -----------------------------------------------------------------------------
//
//   1. Create scripts/.migration.env (this directory) with the four values
//      below, then run the command. The file is gitignored by the project's
//      `.env*` rule — do not commit it.
//
//        WHATSAPP_SOURCE_WABA_ID=...
//        WHATSAPP_SOURCE_ACCESS_TOKEN=...
//        WHATSAPP_TARGET_WABA_ID=...
//        WHATSAPP_TARGET_ACCESS_TOKEN=...
//
//   2. Preview — list what would be copied without writing:
//
//        node --env-file=scripts/.migration.env scripts/migrate-whatsapp-templates.mjs --dry-run
//
//   3. Execute — actually clone the templates:
//
//        node --env-file=scripts/.migration.env scripts/migrate-whatsapp-templates.mjs
//
// Exit codes:
//   0 — all templates copied (or already existed)
//   1 — missing env or fetch failure
//   2 — at least one template failed to create on the target
//
// -----------------------------------------------------------------------------

const GRAPH_API = "https://graph.facebook.com/v22.0";

const SOURCE_WABA = process.env.WHATSAPP_SOURCE_WABA_ID;
const SOURCE_TOKEN = process.env.WHATSAPP_SOURCE_ACCESS_TOKEN;
const TARGET_WABA = process.env.WHATSAPP_TARGET_WABA_ID;
const TARGET_TOKEN = process.env.WHATSAPP_TARGET_ACCESS_TOKEN;

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); // copy even if already on target

function requireEnv() {
  const missing = [];
  if (!SOURCE_WABA) missing.push("WHATSAPP_SOURCE_WABA_ID");
  if (!SOURCE_TOKEN) missing.push("WHATSAPP_SOURCE_ACCESS_TOKEN");
  if (!TARGET_WABA) missing.push("WHATSAPP_TARGET_WABA_ID");
  if (!TARGET_TOKEN) missing.push("WHATSAPP_TARGET_ACCESS_TOKEN");
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    console.error("See the usage notes at the top of this file.");
    process.exit(1);
  }
}

async function listTemplates(wabaId, token, label) {
  const out = [];
  let url =
    `${GRAPH_API}/${wabaId}/message_templates` +
    `?fields=name,language,status,category,components,parameter_format,id` +
    `&limit=100`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${label} list ${res.status}: ${body.slice(0, 400)}`);
    }
    const json = await res.json();
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}

function stripForPost(template) {
  // Meta's GET returns a few fields that aren't accepted on POST (id,
  // status, sub_category, language_policy etc.). We strip them so the
  // create call only carries what Meta's validator expects.
  const body = {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  };
  if (template.parameter_format) {
    body.parameter_format = template.parameter_format;
  }
  return body;
}

async function createTemplate(template) {
  const body = stripForPost(template);
  const res = await fetch(`${GRAPH_API}/${TARGET_WABA}/message_templates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TARGET_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text.slice(0, 400) };
  }
  try {
    const json = JSON.parse(text);
    return { ok: true, id: json.id, status: json.status ?? "PENDING" };
  } catch {
    return { ok: true, id: null, status: "PENDING" };
  }
}

function summarise(template) {
  const header = template.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "HEADER",
  );
  const body = template.components?.find(
    (c) => (c.type ?? "").toUpperCase() === "BODY",
  );
  const bodyPreview = (body?.text ?? "").replace(/\s+/g, " ").slice(0, 80);
  return `${template.name}:${template.language} · ${template.category} · ${header?.text ? `[h] ` : ""}${bodyPreview}${body?.text && body.text.length > 80 ? "…" : ""}`;
}

async function main() {
  requireEnv();

  console.log(
    `\nSource WABA: ${SOURCE_WABA}` +
      `\nTarget WABA: ${TARGET_WABA}` +
      `\nMode:        ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY"}${FORCE ? " + force" : ""}\n`,
  );

  console.log("Fetching source templates…");
  const source = await listTemplates(SOURCE_WABA, SOURCE_TOKEN, "source");
  const approved = source.filter(
    (t) => (t.status ?? "").toUpperCase() === "APPROVED",
  );
  console.log(
    `  found ${source.length} total, ${approved.length} approved (others skipped)\n`,
  );

  if (approved.length === 0) {
    console.log("Nothing to migrate. Exiting.");
    return;
  }

  console.log("Fetching target templates (for dedupe)…");
  const target = await listTemplates(TARGET_WABA, TARGET_TOKEN, "target");
  const targetKeys = new Set(target.map((t) => `${t.name}:${t.language}`));
  console.log(`  target already has ${target.length} template row(s)\n`);

  let toCreate = approved;
  if (!FORCE) {
    toCreate = approved.filter(
      (t) => !targetKeys.has(`${t.name}:${t.language}`),
    );
  }

  console.log(`Plan: create ${toCreate.length} template(s)`);
  for (const t of toCreate) console.log(`  + ${summarise(t)}`);
  const skipCount = approved.length - toCreate.length;
  if (skipCount > 0) {
    console.log(`\nSkipping ${skipCount} already on target (use --force to re-POST).`);
  }

  if (DRY_RUN) {
    console.log("\nDry run complete — no writes performed.");
    return;
  }

  if (toCreate.length === 0) {
    console.log("\nNothing to create. Exiting.");
    return;
  }

  console.log("\nCreating on target…");
  let created = 0;
  let failed = 0;
  const failures = [];
  for (const t of toCreate) {
    process.stdout.write(`  → ${t.name}:${t.language}  `);
    // eslint-disable-next-line no-await-in-loop
    const res = await createTemplate(t);
    if (res.ok) {
      console.log(`ok (${res.status})`);
      created += 1;
    } else {
      console.log(`FAIL ${res.status}`);
      console.log(`    ${res.error}`);
      failed += 1;
      failures.push({ template: `${t.name}:${t.language}`, error: res.error });
    }
  }

  console.log(
    `\nDone.  created: ${created}   failed: ${failed}   skipped: ${skipCount}`,
  );

  if (failed > 0) {
    console.log(
      "\nCommon causes:" +
        "\n  - Token lacks whatsapp_business_management scope on the target WABA" +
        "\n  - Template name already exists in a different case/status on target" +
        "\n  - Body sample values missing or not matching variable count" +
        "\n  - Category restrictions (e.g. URLs requiring a button component)",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message ?? err);
  process.exit(1);
});
