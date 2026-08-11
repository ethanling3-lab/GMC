import "server-only";
import {
  getTemplates,
  findTemplateDef,
  type TemplateDefinition as SyncTemplateDefinition,
} from "./whatsapp-templates-sync";
import {
  metaLanguageFor,
  renderTemplateBody,
  type TemplateLanguage,
  type TemplateSummary,
} from "./whatsapp-templates-types";

// Public accessors over the Meta-synced registry. Hardcoded template list is
// gone — `listTemplates`/`findTemplate` both read from the in-memory cache in
// `whatsapp-templates-sync.ts`, which re-fetches from Meta every 5 minutes or
// on explicit `?refresh=1` from the admin UI.
//
// `TemplateDefinition` now derives its `render()` from the body text Meta
// returned at sync time — no per-template switch to keep in sync with Meta's
// approved copy.

export type TemplateDefinition = SyncTemplateDefinition & {
  render(params: Record<string, string>, language: TemplateLanguage): string;
};

function withRender(def: SyncTemplateDefinition): TemplateDefinition {
  return {
    ...def,
    render(params, language) {
      return renderTemplateBody(def.body_by_language[language], params);
    },
  };
}

export async function listTemplates(): Promise<{
  templates: readonly TemplateDefinition[];
  fetchedAt: number;
  source: "meta" | "empty";
}> {
  const { templates, fetchedAt, source } = await getTemplates();
  return { templates: templates.map(withRender), fetchedAt, source };
}

export async function findTemplate(name: string): Promise<TemplateDefinition | undefined> {
  const def = await findTemplateDef(name);
  return def ? withRender(def) : undefined;
}

export async function refreshTemplates(): Promise<void> {
  await getTemplates({ refresh: true });
}

/**
 * The language string to send to Meta for a template, resolved from the live
 * registry.
 *
 * The lifecycle senders (enrollment-notifications, /api/register) don't go
 * through the registry — they hand-build components and call
 * sendWhatsAppTemplate directly — so they need this to avoid re-introducing
 * the `en_US` guess. It reads the same 5-minute in-memory cache the composer
 * uses, so it is a network call only on a cold start, and it degrades to
 * FALLBACK_META_LANGUAGE rather than throwing: a notification must not fail
 * because the template registry is briefly unreachable.
 */
export async function resolveMetaLanguage(
  templateName: string,
  language: TemplateLanguage,
): Promise<string> {
  try {
    const def = await findTemplate(templateName);
    return metaLanguageFor(def, language);
  } catch {
    return metaLanguageFor(null, language);
  }
}

export function toSummary(def: TemplateDefinition): TemplateSummary {
  return {
    name: def.name,
    category: def.category,
    label_en: def.label_en,
    label_cn: def.label_cn,
    description_en: def.description_en,
    description_cn: def.description_cn,
    languages: def.languages,
    params: def.params,
    body_by_language: def.body_by_language,
    meta_language_by_language: def.meta_language_by_language,
  };
}
