#!/usr/bin/env node
// One-shot helper — creates (or updates) a GMC admin user.
//
// Reads env from process.env or .env.local / .env (first found).
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SEED_EMAIL
//   SEED_PASSWORD            (min 8 chars recommended)
//
// Optional:
//   SEED_ROLE                (default: super_admin)
//   SEED_NAME_EN, SEED_NAME_CN, SEED_REGION
//
// Example:
//   SEED_EMAIL=you@example.com SEED_PASSWORD='long-random' \
//     node scripts/seed-admin.mjs
//
// Security:
//   - Service-role key is only read from env; never logged.
//   - Password is never echoed back in output.

import { createClient } from "@supabase/supabase-js";
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

loadDotEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const role = process.env.SEED_ROLE ?? "super_admin";
const nameEn = process.env.SEED_NAME_EN ?? null;
const nameCn = process.env.SEED_NAME_CN ?? null;
const region = process.env.SEED_REGION ?? null;

function die(msg) {
  console.error(`seed-admin: ${msg}`);
  process.exit(1);
}

if (!url) die("NEXT_PUBLIC_SUPABASE_URL missing");
if (!serviceKey) die("SUPABASE_SERVICE_ROLE_KEY missing");
if (!email) die("SEED_EMAIL missing");
if (!password) die("SEED_PASSWORD missing");
if (password.length < 8) die("SEED_PASSWORD must be at least 8 characters");

const ALLOWED_ROLES = [
  "super_admin",
  "regional_lead",
  "customer_service",
  "finance",
  "instructor",
];
if (!ALLOWED_ROLES.includes(role)) die(`Invalid SEED_ROLE "${role}"`);

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExisting(email) {
  // paginate listUsers until we find a match or run out
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(error.message);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function upsertAdminRow(id) {
  const { error } = await supabase
    .from("admins")
    .upsert(
      { id, role, name_en: nameEn, name_cn: nameCn, region },
      { onConflict: "id" },
    );
  if (error) die(`admins upsert failed: ${error.message}`);
}

let userId;
const existing = await findExisting(email);

if (existing) {
  const { data: upd, error: updErr } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (updErr) die(`updateUserById failed: ${updErr.message}`);
  userId = upd.user.id;
  console.log(`• Existing auth user updated: ${email}`);
} else {
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) die(`createUser failed: ${createErr.message}`);
  userId = created.user.id;
  console.log(`• New auth user created: ${email}`);
}

await upsertAdminRow(userId);
console.log(`✓ Admin seeded — role=${role}, id=${userId}`);
console.log(`  Sign in at /admin/login with the password you set.`);
