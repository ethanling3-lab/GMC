import "server-only";
import type { ChannelAdapter } from "./adapter";
import { whatsappAdapter } from "./whatsapp";
import { lineAdapter } from "./line";

export type ChannelKey = "whatsapp" | "line" | "email";

const REGISTRY: Record<Exclude<ChannelKey, "email">, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  line: lineAdapter,
};

export function getAdapter(channel: ChannelKey): ChannelAdapter {
  const adapter = REGISTRY[channel as Exclude<ChannelKey, "email">];
  if (!adapter) {
    throw new Error(`inbox: no adapter registered for channel '${channel}'`);
  }
  return adapter;
}

export { whatsappAdapter, lineAdapter };
