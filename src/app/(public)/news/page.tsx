import { PagePreamble } from "@/components/marketing/PagePreamble";
import { NewsCard } from "@/components/marketing/NewsCard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";

export const metadata = { title: "News" };
export const revalidate = 60;

async function loadArticles(locale: "zh" | "en") {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("articles")
      .select("slug, title_cn, title_en, excerpt_cn, excerpt_en, published_at, tags, status")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    if (error || !data) return [];
    return data.map((a) => ({
      slug: a.slug,
      title: (locale === "zh" ? a.title_cn : a.title_en) ?? a.title_en ?? a.title_cn ?? a.slug,
      excerpt: (locale === "zh" ? a.excerpt_cn : a.excerpt_en) ?? null,
      published_at: a.published_at,
      tags: a.tags ?? [],
    }));
  } catch {
    return [];
  }
}

export default async function NewsPage() {
  const locale = await getServerLocale();
  const d = getDict(locale);
  const l = (p: string, f?: string) => t(d, p, f);

  const articles = await loadArticles(locale);

  return (
    <>
      <PagePreamble
        eyebrow={l("nav.news", locale === "zh" ? "动态" : "News")}
        heading={locale === "zh" ? "课堂与合作的近期动态。" : "Notes from the programme and our collaborations."}
      />

      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-24">
        {articles.length === 0 ? (
          <div className="py-16 text-center text-[var(--ink-mute)]">{l("landing.newsEmpty")}</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {articles.map((a) => (
              <NewsCard
                key={a.slug}
                href={`/news/${a.slug}`}
                title={a.title}
                excerpt={a.excerpt}
                dateLabel={
                  a.published_at
                    ? new Date(a.published_at).toLocaleDateString(
                        locale === "zh" ? "zh-CN" : "en-GB",
                        { year: "numeric", month: "short", day: "numeric" },
                      )
                    : null
                }
                tag={a.tags?.[0] ?? null}
                readMoreLabel={l("common.readMore")}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
