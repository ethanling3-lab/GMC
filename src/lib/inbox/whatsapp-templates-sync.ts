import "server-only";
import type {
  TemplateLanguage,
  TemplateSummary,
} from "./whatsapp-templates-types";
import { buildParamSpecs } from "./whatsapp-template-labels";

// Dynamic WhatsApp template registry. Fetches the approved template list
// from Meta's Graph API, parses body text + positional placeholders, caches
// in memory for 5 minutes. Falls back to an empty list (with a loud error)
// if WABA_ID / access token are missing — we never silently serve stale data
// once creds are present but the fetch fails.
//
// Meta returns one row per (name, language); we group by `name` so a single
// logical template lists all its approved languages. Templates with header
// variables are allowed but header substitution isn't wired yet — the body
// send path covers the six gmc_* templates we know today, and Meta will
// reject anything with unmet header vars with a clear 132xxx error that
// surfaces in the composer.

const GRAPH_API = "https://graph.facebook.com/v22.0";
const CACHE_TTL_MS = 5 * 60 * 1000;

export type TemplateDefinition = {
  name: string;
  category: TemplateSummary["category"];
  label_en: string;
  label_cn: string;
  description_en: string;
  description_cn: string;
  languages: readonly TemplateLanguage[];
  params: readonly TemplateSummary["params"][number][];
  body_by_language: Readonly<Partial<Record<TemplateLanguage, string>>>;
  /** Build Meta's components[] payload from variable_N params. */
  buildComponents(params: Record<string, string>): WhatsAppComponent[];
};

export type WhatsAppComponent = {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
};

type MetaTemplateRow = {
  id?: string;
  name?: string;
  status?: string;           // APPROVED | PENDING | REJECTED | ...
  language?: string;         // en_US | zh_CN | en | zh | ...
  category?: string;         // UTILITY | MARKETING | AUTHENTICATION
  components?: Array<{
    type?: string;           // HEADER | BODY | FOOTER | BUTTONS
    text?: string;
    format?: string;
  }>;
};

type CacheEntry = {
  templates: TemplateDefinition[];
  fetchedAt: number;
  source: "meta" | "empty";
};

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

export class TemplateSyncError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "meta_error" | "parse_error",
  ) {
    super(message);
  }
}

// -----------------------------------------------------------------------------

function isConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_WABA_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

// Meta returns language codes like `en`, `en_US`, `zh_CN`. We standardise to
// en_US / zh_CN — any other variant is dropped (we don't support sending to
// locales we haven't registered).
function normaliseLanguage(raw: string | undefined): TemplateLanguage | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "en_us" || lower === "en") return "en_US";
  if (lower === "zh_cn" || lower === "zh") return "zh_CN";
  return null;
}

function normaliseCategory(raw: string | undefined): TemplateSummary["category"] {
  switch ((raw ?? "").toUpperCase()) {
    case "MARKETING":
      return "marketing";
    case "AUTHENTICATION":
      return "authentication";
    case "UTILITY":
    default:
      return "utility";
  }
}

function countBodyVariables(body: string): number {
  let max = 0;
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Derive a readable English label + description from a Meta template name.
 * Strips the gmc_ prefix, splits underscores, title-cases. Admin can override
 * via overrides map later; good-enough for freshly-synced templates.
 */
function deriveLabels(name: string): { label_en: string; label_cn: string } {
  const stripped = name.replace(/^gmc[_-]?/i, "");
  const parts = stripped.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) {
    return { label_en: name, label_cn: name };
  }
  const first = parts[0];
  const rest = parts.slice(1).join(" ");
  const label_en = rest
    ? `${first[0].toUpperCase()}${first.slice(1)} · ${rest}`
    : `${first[0].toUpperCase()}${first.slice(1)}`;
  return { label_en, label_cn: label_en };
}

// -----------------------------------------------------------------------------
// Fetch + parse
// -----------------------------------------------------------------------------

async function fetchMetaTemplates(): Promise<MetaTemplateRow[]> {
  if (!isConfigured()) {
    throw new TemplateSyncError(
      "WHATSAPP_WABA_ID + WHATSAPP_ACCESS_TOKEN required to sync templates.",
      "not_configured",
    );
  }

  const url =
    `${GRAPH_API}/${process.env.WHATSAPP_WABA_ID}/message_templates` +
    `?limit=100&fields=name,language,status,category,components`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new TemplateSyncError(
      `Meta templates fetch ${res.status}: ${text.slice(0, 300)}`,
      "meta_error",
    );
  }
  const json = (await res.json()) as { data?: MetaTemplateRow[] };
  return json.data ?? [];
}

function parseTemplateRows(rows: MetaTemplateRow[]): TemplateDefinition[] {
  // Group by name across languages.
  const groups = new Map<
    string,
    {
      name: string;
      category: TemplateSummary["category"];
      languages: TemplateLanguage[];
      bodies: Partial<Record<TemplateLanguage, string>>;
      slotCount: number;
    }
  >();

  for (const row of rows) {
    if (!row.name) continue;
    if ((row.status ?? "").toUpperCase() !== "APPROVED") continue;
    const language = normaliseLanguage(row.language);
    if (!language) continue;

    const body = row.components?.find(
      (c) => (c.type ?? "").toUpperCase() === "BODY",
    );
    if (!body?.text) continue; // body-less templates aren't sendable through our flow

    const slots = countBodyVariables(body.text);
    const existing = groups.get(row.name);
    if (existing) {
      if (!existing.languages.includes(language)) existing.languages.push(language);
      existing.bodies[language] = body.text;
      if (slots > existing.slotCount) existing.slotCount = slots;
    } else {
      groups.set(row.name, {
        name: row.name,
        category: normaliseCategory(row.category),
        languages: [language],
        bodies: { [language]: body.text } as Partial<Record<TemplateLanguage, string>>,
        slotCount: slots,
      });
    }
  }

  const defs: TemplateDefinition[] = [];
  for (const g of groups.values()) {
    const params = buildParamSpecs(g.name, g.slotCount);
    const { label_en, label_cn } = deriveLabels(g.name);
    defs.push({
      name: g.name,
      category: g.category,
      label_en,
      label_cn,
      description_en: describeTemplate(g.name, g.category, g.slotCount),
      description_cn: describeTemplate(g.name, g.category, g.slotCount, true),
      languages: g.languages,
      params,
      body_by_language: g.bodies,
      buildComponents(values) {
        return [
          {
            type: "body",
            parameters: params.map((p) => ({
              type: "text" as const,
              text: (values[p.key] ?? "").trim(),
            })),
          },
        ];
      },
    });
  }

  defs.sort((a, b) => a.name.localeCompare(b.name));
  return defs;
}

function describeTemplate(
  _name: string,
  category: TemplateSummary["category"],
  slots: number,
  cn = false,
): string {
  const prefix = cn ? `${category === "utility" ? "服务" : category === "marketing" ? "营销" : "验证"} · ` : `${category} · `;
  if (cn) return `${prefix}${slots} 个变量`;
  return `${prefix}${slots} parameter${slots === 1 ? "" : "s"}`;
}

// -----------------------------------------------------------------------------
// Public API — cache-aware accessors
// -----------------------------------------------------------------------------

async function loadFresh(): Promise<CacheEntry> {
  // Not configured: return an empty cache and let callers surface the state.
  if (!isConfigured()) {
    const entry: CacheEntry = { templates: [], fetchedAt: Date.now(), source: "empty" };
    cache = entry;
    return entry;
  }
  const rows = await fetchMetaTemplates();
  const templates = parseTemplateRows(rows);
  const entry: CacheEntry = { templates, fetchedAt: Date.now(), source: "meta" };
  cache = entry;
  return entry;
}

export async function getTemplates(options?: {
  refresh?: boolean;
}): Promise<{ templates: TemplateDefinition[]; fetchedAt: number; source: CacheEntry["source"] }> {
  const force = Boolean(options?.refresh);
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  // Coalesce concurrent callers onto a single fetch.
  if (!force && inFlight) return inFlight;
  const p = loadFresh().finally(() => {
    inFlight = null;
  });
  inFlight = p;
  return p;
}

export async function findTemplateDef(name: string): Promise<TemplateDefinition | undefined> {
  const { templates } = await getTemplates();
  return templates.find((t) => t.name === name);
}
