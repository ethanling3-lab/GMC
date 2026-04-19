#!/usr/bin/env node
// One-shot helper — creates (or updates) a GMC admin user.
//
// Reads env from process.env or .env.local / .env (first found).
//
// Required env (read from process.env or .env.local / .env):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// You will be prompted for email + password if not set via env vars.
// Password input is hidden (masked as ****).
//
// Optional env:
//   SEED_EMAIL, SEED_PASSWORD     (skip the prompts — but password
//                                  will land in shell history)
//   SEED_ROLE                     (default: super_admin)
//   SEED_NAME_EN, SEED_NAME_CN, SEED_REGION
//
// Recommended usage (interactive, password never in history):
//   npm run seed-admin
//
// Security:
//   - Service-role key is only read from env; never logged.
//   - Password is never echoed and never logged.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

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

// Plain prompt — echoes input.
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Silent prompt — masks input as *. Used for passwords.
function askSilent(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("stdin is not a TTY — set SEED_PASSWORD env var instead"));
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let buf = "";
    const onData = (ch) => {
      // Handle each character event (could be a string of one char in raw mode).
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (c === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") {
          // Backspace
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        buf += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

loadDotEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let email = process.env.SEED_EMAIL;
let password = process.env.SEED_PASSWORD;
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

if (!email) {
  email = await ask("Email: ");
  if (!email) die("Email is required");
}

if (!password) {
  password = await askSilent("Password (input hidden): ");
  if (!password) die("Password is required");
  const confirm = await askSilent("Confirm password:        ");
  if (password !== confirm) die("Passwords did not match");
}

if (password.length < 8) die("Password must be at least 8 characters");

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
