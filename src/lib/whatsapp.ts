import "server-only";

// Back-compat shim — the WhatsApp implementation moved to
// `src/lib/inbox/channels/whatsapp.ts` as part of the M5 unified inbox.
// Existing callers (enrollment-notifications.ts) keep working through this
// re-export.

export {
  isWhatsAppConfigured,
  sendWhatsAppTemplate,
} from "./inbox/channels/whatsapp";
