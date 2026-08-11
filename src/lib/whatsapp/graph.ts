// Single source of truth for the Meta Graph API base URL.
//
// The version literal was previously pinned in three independent places
// (the channel adapter, the template sync, and scripts/migrate-whatsapp-
// templates.mjs), so bumping it meant finding all three. WhatsApp Flows
// and newer interactive message types are version-gated, so this will be
// bumped — make it one edit.
//
// Override with WHATSAPP_GRAPH_VERSION to test a newer version without a
// code change; Meta keeps roughly two years of versions alive, so the
// pinned default is deliberate rather than "latest".

export const DEFAULT_GRAPH_VERSION = "v22.0";

export function graphVersion(): string {
  const override = process.env.WHATSAPP_GRAPH_VERSION?.trim();
  return override && /^v\d+\.\d+$/.test(override)
    ? override
    : DEFAULT_GRAPH_VERSION;
}

export function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

// Build a Graph URL. `path` may start with or without a leading slash.
export function graphUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${graphBase()}${suffix}`;
}
