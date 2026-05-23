// Client-safe types + helpers for inbox snippets.
//
// Lives separate from `snippets.ts` (which is "server-only") because the
// composer + management UI both import the types. Following the
// established pattern documented in the project memory.

export type SnippetVariableKey =
  | "name"
  | "name_zh"
  | "region_id"
  | "phone"
  | "email"
  | "event_title"
  | "event_title_zh"
  | "event_date"
  | "event_venue";

export type SnippetVariableSpec = {
  key: SnippetVariableKey;
  label_en: string;
  label_zh: string;
  example: string;
};

// Single source of truth for the variables the composer + management page
// surface to admins. Resolver maps each key to a string from the conversation
// context; unknown keys in a body are left as raw `{token}` so admins notice.
export const SNIPPET_VARIABLES: readonly SnippetVariableSpec[] = [
  { key: "name", label_en: "Participant name (EN)", label_zh: "学员姓名 (英)", example: "Ethan Ling" },
  { key: "name_zh", label_en: "Participant name (中)", label_zh: "学员姓名 (中)", example: "凌广德" },
  { key: "region_id", label_en: "Region ID", label_zh: "学员编号", example: "MY001" },
  { key: "phone", label_en: "Phone", label_zh: "电话", example: "+60123456789" },
  { key: "email", label_en: "Email", label_zh: "邮箱", example: "user@example.com" },
  { key: "event_title", label_en: "Event title (EN)", label_zh: "活动名称 (英)", example: "GMC Retreat 2026" },
  { key: "event_title_zh", label_en: "Event title (中)", label_zh: "活动名称 (中)", example: "禅修营 2026" },
  { key: "event_date", label_en: "Event date", label_zh: "活动日期", example: "2026-06-12" },
  { key: "event_venue", label_en: "Event venue", label_zh: "活动地点", example: "Kuala Lumpur" },
] as const;

export type Snippet = {
  id: string;
  shortcut: string;
  title_en: string;
  title_zh: string;
  body_en: string;
  body_zh: string;
  description_en: string | null;
  description_zh: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SnippetContext = Partial<Record<SnippetVariableKey, string>>;

// Scans a body string for `{variable_key}` tokens and returns the set of
// keys found. Unknown keys (not in SNIPPET_VARIABLES) are still returned —
// the management UI flags them so admins can see typos.
export function extractSnippetVariables(body: string): string[] {
  const seen = new Set<string>();
  const re = /\{([a-z][a-z0-9_]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

const KNOWN_KEYS = new Set<string>(SNIPPET_VARIABLES.map((v) => v.key));

export function isKnownVariable(key: string): key is SnippetVariableKey {
  return KNOWN_KEYS.has(key);
}

// Substitutes `{key}` tokens with values from `context`. Unknown keys and
// keys without context values are left as-is so admin sees `{name}` and
// realises they need to fill it in manually.
export function resolveSnippetBody(body: string, context: SnippetContext): string {
  return body.replace(/\{([a-z][a-z0-9_]*)\}/g, (raw, key: string) => {
    if (!isKnownVariable(key)) return raw;
    const val = context[key];
    return typeof val === "string" && val.length > 0 ? val : raw;
  });
}

// Validation shared between the management form (client) and the API
// (server). Mirrors the SQL CHECK constraint on `shortcut`.
export const SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validateShortcut(shortcut: string): string | null {
  if (!shortcut) return "Shortcut is required.";
  if (!SHORTCUT_PATTERN.test(shortcut)) {
    return "Shortcut must be lowercase letters, digits and hyphens (2–40 chars, starting with a letter or digit).";
  }
  return null;
}
