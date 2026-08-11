#!/usr/bin/env node
// Create GMC's WhatsApp message templates on a WABA.
//
//   npm run create:templates            # dry run — shows what WOULD be created
//   npm run create:templates -- --apply # submit them to Meta for review
//
// Idempotent: existing (name, language) pairs are skipped, so re-running after
// a partial failure is safe.
//
// WHY THIS IS A SCRIPT AND NOT A CLICK-THROUGH
//
// Every template has to exist in BOTH languages with EXACTLY the variable
// count and order the code sends, and in the UTILITY category. Getting any of
// those three wrong fails at send time with an error that doesn't say which
// one is wrong:
//   - wrong variable count  → 132000
//   - wrong language        → 132001  (this is what made 100% of English
//                             sends fail: templates approved as `en`, code
//                             asking for `en_US`)
//   - MARKETING category    → deliverable, but silently blocked by opt-out
//                             (131050) and Meta's frequency cap (131049), so
//                             a participant stops getting their own payment
//                             link and nobody finds out
//
// Doing it by hand 14 times is 14 chances to get one of those wrong. It also
// has to be repeated verbatim on the production WABA at cutover.
//
// The bodies for gmc_enrollment_approved and gmc_payment_received are copied
// verbatim from the versions Meta already APPROVED on the test WABA, so they
// are known-good copy rather than a fresh gamble at review.

import { readFileSync, existsSync } from "node:fs";

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

type Variant = {
  /** Meta's language code. GMC uses plain `en`, NOT `en_US`. */
  language: string;
  body: string;
  /** One sample per {{n}}, in order. Meta rejects submissions without these. */
  example: string[];
};

type TemplateDef = {
  name: string;
  /** Always UTILITY — every one of these is transactional. See header. */
  category: "UTILITY";
  variants: Variant[];
};

const NAME_EN = "Tan Wei Ming";
const NAME_ZH = "陈伟明";
const EVENT_EN = "Business Program 2026";
const EVENT_ZH = "化性禅 2026";
const AMOUNT = "SGD 880";
const PAY_URL = "https://gmcglobal.com/pay/a1b2c3d4";
const CONFIRM_URL = "https://gmcglobal.com/confirm/a1b2c3d4";

const TEMPLATES: TemplateDef[] = [
  {
    name: "gmc_confirm_registration",
    category: "UTILITY",
    variants: [
      {
        language: "en",
        body: "Hi {{1}}, thanks for registering with GMC. Please review and confirm your details here: {{2}} — your place is held until you confirm.",
        example: [NAME_EN, CONFIRM_URL],
      },
      {
        language: "zh_CN",
        body: "您好{{1}}，感谢您报名 GMC。请通过此链接确认您的资料：{{2}}，确认后我们将为您保留名额。",
        example: [NAME_ZH, CONFIRM_URL],
      },
    ],
  },
  {
    // Body copied verbatim from the APPROVED version on the test WABA.
    name: "gmc_enrollment_approved",
    category: "UTILITY",
    variants: [
      {
        language: "en",
        body: "Dear {{1}}, we're delighted to have you joining us for {{2}}. Please complete your payment of {{3}} here: {{4}} and your registration will be fully confirmed.",
        example: [NAME_EN, EVENT_EN, AMOUNT, PAY_URL],
      },
      {
        language: "zh_CN",
        body: "您好*{{1}}*，很高兴您将加入「*{{2}}* 」。请通过此链接完成 *{{3}}* 的付款：{{4}}，完成后您的报名即正式确认。",
        example: [NAME_ZH, EVENT_ZH, AMOUNT, PAY_URL],
      },
    ],
  },
  {
    // Body copied verbatim from the APPROVED version on the test WABA.
    name: "gmc_payment_received",
    category: "UTILITY",
    variants: [
      {
        language: "en",
        body: "Thank you *{{1}}*. We've received your payment for *{{2}}*. Amount: *{{3}}*. Your registration is now fully confirmed.",
        example: [NAME_EN, EVENT_EN, AMOUNT],
      },
      {
        language: "zh_CN",
        body: "您好*{{1}}*，感谢您完成付款。我们已收到您「*{{2}}*」的付款，金额：*{{3}}*。您的报名已全部确认。",
        example: [NAME_ZH, EVENT_ZH, AMOUNT],
      },
    ],
  },
  {
    name: "gmc_enrollment_rejected_no_seats",
    category: "UTILITY",
    variants: [
      // NOTE: an earlier draft ended "We'll let you know as soon as the next
      // session opens." Meta's classifier read that forward-looking offer as
      // promotional and re-categorised the template to MARKETING on
      // submission — which would leave it blockable by opt-out (131050) and
      // the frequency cap (131049), so a rejected applicant might never learn
      // they were rejected. Keep rejection copy strictly transactional: state
      // the outcome, offer a reply, promise nothing.
      {
        language: "en",
        body: "Dear {{1}}, thank you for your interest in {{2}}. Unfortunately all places for this session are now taken, so we are unable to confirm your registration.",
        example: [NAME_EN, EVENT_EN],
      },
      {
        language: "zh_CN",
        body: "您好{{1}}，感谢您对「{{2}}」的关注。很抱歉，本期名额已满，我们无法为您确认报名。",
        example: [NAME_ZH, EVENT_ZH],
      },
    ],
  },
  {
    name: "gmc_enrollment_rejected_duplicate",
    category: "UTILITY",
    variants: [
      {
        language: "en",
        body: "Dear {{1}}, we found an existing registration for {{2}} under your details, so we've kept the original and cancelled the duplicate. No action is needed.",
        example: [NAME_EN, EVENT_EN],
      },
      {
        language: "zh_CN",
        body: "您好{{1}}，我们发现您已报名「{{2}}」，因此保留了原有报名并取消了重复的一笔。您无需另行处理。",
        example: [NAME_ZH, EVENT_ZH],
      },
    ],
  },
  {
    name: "gmc_enrollment_rejected_unsuitable",
    category: "UTILITY",
    variants: [
      // Same lesson as no_seats above: "we'd be glad to suggest a programme
      // that fits better" is an upsell to Meta's classifier. Inviting a reply
      // is fine; offering something is not.
      {
        language: "en",
        body: "Dear {{1}}, thank you for applying for {{2}}. On this occasion we are unable to confirm your place. Please reply here if you would like to discuss this with our team.",
        example: [NAME_EN, EVENT_EN],
      },
      {
        language: "zh_CN",
        body: "您好{{1}}，感谢您报名「{{2}}」。很抱歉本次未能为您确认名额。如需了解详情，您可直接回复此讯息。",
        example: [NAME_ZH, EVENT_ZH],
      },
    ],
  },
  {
    name: "gmc_enrollment_rejected_other",
    category: "UTILITY",
    variants: [
      {
        language: "en",
        body: "Dear {{1}}, thank you for applying for {{2}}. We're unable to confirm your place at this time. Please reply here and our team will help.",
        example: [NAME_EN, EVENT_EN],
      },
      {
        language: "zh_CN",
        body: "您好{{1}}，感谢您报名「{{2}}」。我们暂时无法为您确认名额，您可直接回复此讯息，我们的团队会协助您。",
        example: [NAME_ZH, EVENT_ZH],
      },
    ],
  },
];

/** Meta rejects a body whose first or last character is a variable. */
function validateBody(body: string, expected: number): string | null {
  const trimmed = body.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) return "body starts with a variable";
  if (/\{\{\d+\}\}$/.test(trimmed)) return "body ends with a variable";
  if (/\}\}\s*\{\{/.test(trimmed)) return "two variables are adjacent";
  const found = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  if (found.size !== expected) {
    return `body has ${found.size} distinct variables, ${expected} examples supplied`;
  }
  for (let i = 1; i <= expected; i += 1) {
    if (!found.has(i)) return `body is missing {{${i}}}`;
  }
  return null;
}

async function main() {
  loadDotEnv();
  const apply = process.argv.includes("--apply");
  const waba = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!waba || !token) {
    console.error("Missing WHATSAPP_WABA_ID / WHATSAPP_ACCESS_TOKEN");
    process.exit(1);
  }
  const version = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v22.0";

  // Local validation first — a malformed body should never reach Meta.
  let invalid = 0;
  for (const t of TEMPLATES) {
    for (const v of t.variants) {
      const err = validateBody(v.body, v.example.length);
      if (err) {
        console.error(`  INVALID  ${t.name} [${v.language}] — ${err}`);
        invalid++;
      }
    }
  }
  if (invalid > 0) {
    console.error(`\n${invalid} template body/bodies would be rejected. Fix before submitting.`);
    process.exit(1);
  }

  // What already exists on this WABA, in any status.
  const existing = new Set<string>();
  let url: string | undefined =
    `https://graph.facebook.com/${version}/${waba}/message_templates?fields=name,language,status&limit=100`;
  while (url) {
    const res: Response = await fetch(`${url}&access_token=${token}`);
    const json = (await res.json()) as {
      data?: Array<{ name?: string; language?: string; status?: string }>;
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      console.error(`Meta error listing templates: ${json.error?.message}`);
      process.exit(1);
    }
    for (const t of json.data ?? []) existing.add(`${t.name}:${t.language}`);
    url = json.paging?.next?.replace(/&access_token=[^&]*/, "");
  }

  console.log(`\nWABA ${waba} — ${existing.size} existing template variant(s)\n`);

  const todo: Array<{ def: TemplateDef; variant: Variant }> = [];
  for (const def of TEMPLATES) {
    for (const variant of def.variants) {
      const key = `${def.name}:${variant.language}`;
      if (existing.has(key)) {
        console.log(`  skip     ${key}  (already exists)`);
        continue;
      }
      todo.push({ def, variant });
      console.log(`  create   ${key}  [${variant.example.length} vars, ${def.category}]`);
    }
  }

  if (todo.length === 0) {
    console.log(`\nNothing to create.`);
    return;
  }
  if (!apply) {
    console.log(`\nDry run — ${todo.length} to create. Re-run with --apply to submit to Meta.`);
    return;
  }

  console.log(`\nSubmitting ${todo.length}…\n`);
  let ok = 0;
  const failures: string[] = [];
  for (const { def, variant } of todo) {
    const key = `${def.name}:${variant.language}`;
    const payload = {
      name: def.name,
      language: variant.language,
      category: def.category,
      components: [
        {
          type: "BODY",
          text: variant.body,
          example: { body_text: [variant.example] },
        },
      ],
    };
    const res = await fetch(
      `https://graph.facebook.com/${version}/${waba}/message_templates`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || json.error) {
      const msg = json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}`;
      console.log(`  FAIL     ${key} — ${msg}`);
      failures.push(`${key}: ${msg}`);
      continue;
    }
    console.log(`  ok       ${key}  → ${json.status ?? "submitted"}`);
    ok++;
  }

  console.log(`\n${ok}/${todo.length} submitted.`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `\nMeta reviews these — usually minutes, sometimes hours. Run 'npm run check:templates' to watch for APPROVED.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
