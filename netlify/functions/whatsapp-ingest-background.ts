// Netlify background function — 15-minute timeout, returns 202 immediately.
// Triggered by the WhatsApp webhook route after it enqueues, and by the
// webhook sweeper cron.
//
// All logic lives in src/lib/inbox/ingest-worker.ts so that the localhost path
// (which has no Netlify functions runtime) runs exactly the same code via
// `after()`. Two invocation paths, one implementation.
//
// Idempotency: status='pending' is the unit of work, and the claim marks rows
// 'processing' before any of it runs. Re-invocation is always safe — it either
// finds nothing to claim or picks up rows a previous run abandoned.
//
// Permissions: invoked internally with SUPABASE_SERVICE_ROLE_KEY; it does not
// authenticate its caller. Nothing about the request selects the work — the
// queue does — so an unauthorised trigger can at worst do work we wanted done.

import { drainWebhookQueue } from "../../src/lib/inbox/ingest-worker";

export async function handler(): Promise<{ statusCode: number }> {
  try {
    const summary = await drainWebhookQueue();
    const noise =
      summary.claimed > 0 || summary.errors.length > 0
        ? `claimed=${summary.claimed} processed=${summary.processed} `
          + `duplicates=${summary.duplicates} retried=${summary.retried} dead=${summary.dead}`
        : null;
    if (noise) console.log(`[whatsapp-ingest-background] ${noise}`);
    for (const err of summary.errors) {
      console.error(`[whatsapp-ingest-background] ${err}`);
    }
  } catch (err) {
    // Never rethrow. A crash here leaves rows in 'processing', which the
    // sweeper reclaims — that is the designed recovery, and a non-202 would
    // only make Netlify retry on top of it.
    console.error(
      `[whatsapp-ingest-background] fatal: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { statusCode: 202 };
}
