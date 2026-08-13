import "server-only";
import type { ChannelAdapter } from "./adapter";
import { whatsappAdapter } from "./whatsapp";

// LINE was dropped in the 2026-08-11 simplification pass: one live channel is
// enough to get right, and every conditional it added was a conditional in the
// way of the WhatsApp work. The `comm_channel` Postgres enum keeps its 'line'
// value (dropping an enum value is painful and buys nothing), so historical
// rows still read back fine — there is simply no adapter to dispatch to.
export type ChannelKey = "whatsapp" | "email";

const REGISTRY: Record<Exclude<ChannelKey, "email">, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
};

export function getAdapter(channel: ChannelKey): ChannelAdapter {
  const adapter = REGISTRY[channel as Exclude<ChannelKey, "email">];
  if (!adapter) {
    throw new Error(`inbox: no adapter registered for channel '${channel}'`);
  }
  return adapter;
}

export { whatsappAdapter };
