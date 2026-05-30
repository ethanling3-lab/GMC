#!/usr/bin/env node
// Smoke test for the M7.6 Broadcasts pipeline.
//
// Hits the real staging Supabase (via SUPABASE_SERVICE_ROLE_KEY) but
// runs the send path in mocked mode (no NEXT_PUBLIC_SITE_URL → the
// background fan-out kick returns mocked, and sendEmail mocks without
// SMTP creds). Verifies:
//   1. Audience resolver returns reachable recipients for a real event
//      cohort on the-golden-principles.
//   2. Materialize inserts broadcast_recipients rows correctly.
//   3. Interpolation token resolution works against a real participant.
//
// Run with: npx tsx scripts/smoke-broadcasts.ts
//
// Env needed:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional:
//   GMC_EVENT_ID (defaults to the-golden-principles)

import { createClient } from "@supabase/supabase-js";
import type {
  AudienceFilter,
  BroadcastChannel,
} from "../src/lib/broadcasts/types.ts";

const EVENT_ID =
  process.env.GMC_EVENT_ID ?? "769eef6a-a099-4603-88e6-be33b580b6a2"; // the-golden-principles

function pass(label: string, info?: string) {
  console.log(`  ✓ ${label}${info ? ` · ${info}` : ""}`);
}
function fail(label: string, err: unknown): never {
  console.error(`  ✗ ${label}`);
  console.error(err);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("env check", new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required"));

  // Bypass `server-only` sentinel before pulling in the broadcasts libs —
  // same workaround as scripts/smoke-grouping.ts:514-520.
  process.env.NEXT_RUNTIME = "nodejs";
  const serverOnlyPath = (await import("node:path")).resolve(
    "node_modules/server-only/index.js",
  );
  // @ts-expect-error — node-internal cache surface
  delete require.cache?.[serverOnlyPath];
  // @ts-expect-error — overwrite with noop
  require.cache[serverOnlyPath] = { exports: {}, loaded: true, id: serverOnlyPath, filename: serverOnlyPath };

  const { resolveAudience, buildAudienceSummary } = await import("../src/lib/broadcasts/audience.ts");
  const { interpolateWithDiagnostics } = await import("../src/lib/broadcasts/interpolate.ts");
  const { materialiseRecipients } = await import("../src/lib/broadcasts/materialize.ts");

  const supabase = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pick a real super_admin from the DB so the FK on broadcasts.created_by holds.
  const { data: adminRow } = await supabase
    .from("admins")
    .select("id")
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  if (!adminRow) fail("admin lookup", new Error("no super_admin found on staging"));
  const superAdmin = {
    id: adminRow!.id as string,
    email: "smoke@gmc",
    name_cn: null,
    name_en: "smoke",
    role: "super_admin" as const,
    region: null,
  };

  console.log("[1] Audience resolver — event cohort on the-golden-principles");
  const channels: BroadcastChannel[] = ["whatsapp", "email"];
  const filter: AudienceFilter = {
    mode: "event_cohort",
    event_id: EVENT_ID,
    enrollment_statuses: ["approved", "paid"],
    language: null,
    tag_slug: null,
  };
  const resolution = await resolveAudience(supabase, superAdmin, filter, channels);
  pass(
    "resolved",
    `${resolution.recipients.length} reachable / ${resolution.total_matched} matched / ${resolution.excluded_no_address} no-address`,
  );
  if (resolution.recipients.length === 0) {
    console.warn("  ! No reachable recipients — staging event may have no approved/paid enrolments. Skipping further checks.");
    return;
  }

  console.log("[2] Audience summary build");
  const summary = buildAudienceSummary(filter, "The Golden Principles");
  pass("built", summary);

  console.log("[3] Interpolation against a real participant");
  const sample = resolution.recipients[0];
  const { data: ev } = await supabase
    .from("events")
    .select("title_en, title_cn, start_date, end_date, venue, main_venue_hotel_name, price")
    .eq("id", EVENT_ID)
    .maybeSingle();
  const ctx = {
    participant: {
      name_cn: sample.name_cn,
      name_en: sample.name_en,
      region_id: sample.region_id,
      language_fluency: sample.language_fluency,
    },
    event: ev as unknown as {
      title_en: string | null;
      title_cn: string | null;
      start_date: string | null;
      end_date: string | null;
      venue: string | null;
      main_venue_hotel_name: string | null;
      price: number | string | null;
    } | null,
    enrollment: sample.enrollment_id ? { id: sample.enrollment_id } : null,
  };
  const template =
    "你好 ${name_cn} (${region_id})，活动 ${event.title_cn} 将于 ${event.start_date} 开始。请于 ${payment_link} 完成付款 ${amount_due} 元。";
  const { rendered, unresolved } = interpolateWithDiagnostics(template, ctx);
  pass("rendered", rendered.slice(0, 80) + (rendered.length > 80 ? "…" : ""));
  if (unresolved.length > 0) {
    console.warn(`  ! Unresolved tokens: ${unresolved.join(", ")}`);
  } else {
    pass("all tokens resolved");
  }

  console.log("[4] Materialize a fake broadcast (cleaned up after)");
  const { data: broadcast, error: bErr } = await supabase
    .from("broadcasts")
    .insert({
      name: `smoke ${new Date().toISOString()}`,
      audience_mode: "event_cohort",
      audience_filter: filter,
      audience_snapshot_count: resolution.recipients.length,
      channels,
      created_by: superAdmin.id,
      status: "draft",
    })
    .select("id")
    .single();
  if (bErr || !broadcast) fail("broadcast insert", bErr);
  const broadcastId = broadcast!.id as string;
  try {
    const { queued, total_pending } = await materialiseRecipients(supabase, superAdmin, {
      id: broadcastId,
      audience_mode: "event_cohort",
      audience_filter: filter,
      channels,
    });
    pass("materialised", `queued=${queued} total_pending=${total_pending}`);

    const { count: recipientCount } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);
    pass("rows persisted", `${recipientCount} broadcast_recipients`);

    // Re-materialise — should be a no-op thanks to the unique constraint.
    const second = await materialiseRecipients(supabase, superAdmin, {
      id: broadcastId,
      audience_mode: "event_cohort",
      audience_filter: filter,
      channels,
    });
    const { count: afterCount } = await supabase
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);
    if (afterCount !== recipientCount) {
      fail("re-materialise idempotency", new Error(`expected ${recipientCount}, got ${afterCount}`));
    }
    pass("re-materialise idempotent", `still ${afterCount} (queued attempted ${second.queued})`);
  } finally {
    await supabase.from("broadcasts").delete().eq("id", broadcastId);
    pass("cleanup", "broadcast row deleted (recipients cascade)");
  }

  console.log("\nAll smoke checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
