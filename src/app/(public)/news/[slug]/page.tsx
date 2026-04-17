import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

async function loadArticle(slug: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title_cn, title_en, body_cn, body_en, published_at, tags, author_name, author_role, status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) return { title: "News" };
  return { title: article.title_en ?? article.title_cn ?? "News" };
}

export default async function ArticlePage({ params }: PageProps) {
  const [locale, { slug }] = await Promise.all([getServerLocale(), params]);
  const article = await loadArticle(slug);
  if (!article) notFound();

  const title = (locale === "zh" ? article.title_cn : article.title_en) ?? article.title_en ?? article.title_cn ?? slug;
  const body = (locale === "zh" ? article.body_cn : article.body_en) ?? "";

  return (
    <article className="mx-auto max-w-[760px] px-6 md:px-10 pt-20 md:pt-28 pb-24">
      <Link
        href="/news"
        className="inline-flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
      >
        <span aria-hidden="true">←</span>
        {locale === "zh" ? "返回动态" : "Back to news"}
      </Link>

      {article.published_at ? (
        <div className="mt-10 flex items-center gap-3 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
          {new Date(article.published_at).toLocaleDateString(
            locale === "zh" ? "zh-CN" : "en-GB",
            { year: "numeric", month: "long", day: "numeric" },
          )}
          {article.tags?.[0] ? (
            <>
              <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" />
              <span>{article.tags[0]}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <h1 className="mt-6 font-display text-[var(--ink)]">{title}</h1>

      {article.author_name ? (
        <div className="mt-8 flex items-center gap-3 text-[13px] text-[var(--ink-mute)]">
          <span>{article.author_name}</span>
          {article.author_role ? (
            <>
              <span className="w-1 h-1 rounded-full bg-[var(--paper-shadow)]" />
              <span>{article.author_role}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="rule-notch my-12" aria-hidden="true"><span className="mark" /></div>

      <div className="prose-body text-[16px] leading-[1.85] text-[var(--ink-soft)] whitespace-pre-wrap">
        {body}
      </div>
    </article>
  );
}
