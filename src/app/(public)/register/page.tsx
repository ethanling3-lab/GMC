import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";
import { verifyPrefillToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ event?: string; prefill?: string }>;
};

async function loadOpenEvents() {
  try {
    const supabase = createSupabaseServiceClient();
    const primary = await supabase
      .from("events")
      .select("slug, title_cn, title_en, status, form_schema")
      .eq("status", "open")
      .order("start_date", { ascending: true });

    // Until migration 008 is applied, the form_schema column doesn't exist —
    // fall back to the legacy columns and default the schema. Only swallow
    // errors that look like a missing column so real infra issues still fail.
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703" && code !== "PGRST116") return [];
      const fallback = await supabase
        .from("events")
        .select("slug, title_cn, title_en, status")
        .eq("status", "open")
        .order("start_date", { ascending: true });
      if (fallback.error || !fallback.data) return [];
      return fallback.data.map((e) => ({
        slug: e.slug,
        title_cn: e.title_cn,
        title_en: e.title_en,
        form_schema: {},
      }));
    }
    if (!primary.data) return [];
    return primary.data.map((e) => ({
      slug: e.slug,
      title_cn: e.title_cn,
      title_en: e.title_en,
      form_schema: e.form_schema ?? {},
    }));
  } catch {
    return [];
  }
}

// Resolve a prefill token into a safe subset of participant data. We return
// `null` for every failure mode — bad signature, expired, no participant — so
// the form falls back to the empty state without leaking existence.
async function resolvePrefill(token: string | undefined) {
  if (!token) return null;
  const parsed = verifyPrefillToken(token);
  if (!parsed) return null;

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("participants")
      .select(
        "name_en, name_cn, email, phone, region, gender, birth_date, occupation, industry",
      )
      .eq("id", parsed.participantId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export default async function RegisterPage({ searchParams }: PageProps) {
  const [locale, events, sp] = await Promise.all([
    getServerLocale(),
    loadOpenEvents(),
    searchParams,
  ]);
  const d = getDict(locale);
  const l = (p: string, f?: string) => t(d, p, f);

  const prefillValues = await resolvePrefill(sp.prefill);
  const prefillToken = prefillValues ? sp.prefill : undefined;

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-[10%] -left-[8%] w-[420px] h-[420px] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, var(--cinnabar-wash), transparent 70%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-[880px] px-6 md:px-10 pt-20 md:pt-28 pb-24">
        <span className="eyebrow">{l("register.title")}</span>
        <h1 className="mt-5 font-display text-[var(--ink)]">
          {locale === "zh"
            ? "填写报名信息"
            : "Complete your registration"}
        </h1>
        <p className="mt-5 text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[640px]">
          {l("register.subtitle")}
        </p>

        <div className="mt-12 bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-8 md:p-12 shadow-[var(--shadow-paper-1)]">
          {events.length === 0 ? (
            <div className="py-10 text-center text-[var(--ink-mute)]">
              {locale === "zh"
                ? "目前暂无对外开放的课程。请稍后回来查看。"
                : "No events are open for public registration right now. Please check back shortly."}
            </div>
          ) : (
            <RegistrationForm
              events={events}
              defaultEventSlug={sp.event}
              prefillToken={prefillToken}
              prefillValues={prefillValues}
            />
          )}
        </div>
      </div>
    </div>
  );
}
