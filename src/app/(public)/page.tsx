import { VideoHero } from "@/components/marketing/VideoHero";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ProgramCard } from "@/components/marketing/ProgramCard";
import { StatsBand } from "@/components/marketing/StatsBand";
import { PartnersStrip } from "@/components/marketing/PartnersStrip";
import { CTABlock } from "@/components/marketing/CTABlock";
import { NewsCard } from "@/components/marketing/NewsCard";
import { TestimonialCarousel } from "@/components/marketing/TestimonialCarousel";
import { EventRail, type EventRailItem } from "@/components/marketing/EventRail";
import { TESTIMONIALS } from "@/data/testimonials";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const revalidate = 60;

type PreviewArticle = {
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  tags: string[];
};

async function fetchArticlePreviews(locale: "zh" | "en"): Promise<PreviewArticle[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("articles")
      .select("slug, title_cn, title_en, excerpt_cn, excerpt_en, published_at, tags, status")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(3);
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

async function fetchUpcomingEvents(locale: "zh" | "en"): Promise<EventRailItem[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("events")
      .select("slug, title_cn, title_en, heading_cn, heading_en, city, mode, start_date, status")
      .eq("status", "open")
      .order("start_date", { ascending: true })
      .limit(6);
    if (error || !data) return [];
    return data.map((e) => ({
      slug: e.slug,
      title: (locale === "zh" ? e.title_cn : e.title_en) ?? e.title_en ?? e.title_cn ?? e.slug,
      heading: (locale === "zh" ? e.heading_cn : e.heading_en) ?? null,
      city: e.city ?? null,
      mode: e.mode ?? null,
      start_date: e.start_date ?? null,
    }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const locale = await getServerLocale();
  const d = getDict(locale);
  const l = (path: string, fallback?: string) => t(d, path, fallback);

  const programs = [
    { idx: "01", key: "ph",  href: "/programs/philosophy-of-humanities", image: "/programs/philosophy.jpg" },
    { idx: "02", key: "bp",  href: "/programs/business-program",         image: undefined },
    { idx: "03", key: "cw",  href: "/programs/culinary-wealth",          image: "/programs/culinary.jpg" },
    { idx: "04", key: "bgm", href: "/programs/bgm-youth",                image: "/programs/bgm-youth.jpg" },
  ];

  const stats = [
    { value: "100K+", label: l("landing.statsStudents") },
    { value: "36",    label: l("landing.statsCourses") },
    { value: "35+",   label: l("landing.statsRegions") },
    { value: "75+",   label: l("landing.statsCities") },
  ];

  const [articles, events] = await Promise.all([
    fetchArticlePreviews(locale),
    fetchUpcomingEvents(locale),
  ]);

  return (
    <>
      <VideoHero />

      {/* Core Philosophy — verbatim from gmcglobal.com */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 py-20 md:py-28">
        <div className="grid md:grid-cols-[0.9fr_1.1fr] gap-10 md:gap-20 items-start">
          <div>
            <span className="eyebrow">{l("landing.missionEyebrow")}</span>
            <h2 className="mt-5 font-display text-[var(--ink)] text-[44px] md:text-[56px] leading-[1.05] tracking-[-0.02em]">
              {l("landing.missionHeading")}
            </h2>
            <div className="rule-notch mt-8" aria-hidden="true">
              <span className="mark" />
            </div>
          </div>
          <ol className="flex flex-col gap-10">
            {[1, 2, 3].map((n) => (
              <li key={n} className="grid grid-cols-[48px_1fr] gap-5 md:gap-7 items-start">
                <span className="font-display text-[15px] tracking-[0.22em] text-[var(--cinnabar)] pt-1">
                  — {String(n).padStart(2, "0")}
                </span>
                <p className="text-[16px] md:text-[17px] leading-[1.8] text-[var(--ink-soft)]">
                  {l(`landing.missionPoint${n}`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Programs */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-20 md:pb-28">
        <SectionHeader
          eyebrow={l("landing.programsEyebrow")}
          heading={l("landing.programsHeading")}
          sub={l("landing.programsSub")}
          action={{ href: "/programs", label: l("common.viewAll") }}
        />
        <div className="mt-10 md:mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {programs.map((p) => (
            <ProgramCard
              key={p.key}
              index={p.idx}
              title={l(`programs.${p.key}.title`)}
              teaser={l(`programs.${p.key}.teaser`)}
              href={p.href}
              ctaLabel={l("common.learnMore")}
              imageSrc={p.image}
              imageAlt={l(`programs.${p.key}.title`)}
            />
          ))}
        </div>
      </section>

      {/* Upcoming events — horizontal rail */}
      <EventRail
        items={events}
        eyebrow={locale === "zh" ? "近期活动" : "Upcoming"}
        heading={locale === "zh" ? "正在开放报名的活动" : "What's currently open"}
        sub={locale === "zh" ? "从季度静修到企业家圆桌——横向滑动查看。" : "From seasonal retreats to the business cohort — scroll horizontally to browse."}
        viewAllHref="/events"
        emptyLabel={locale === "zh"
          ? "目前暂无对外开放的活动。请稍后回来查看，或填写报名意向表与我们联络。"
          : "No events are open for registration right now. Please check back soon or register your interest."}
      />

      {/* Stats band */}
      <StatsBand
        eyebrow={l("landing.statsEyebrow")}
        heading={l("landing.statsHeading")}
        stats={stats}
      />

      {/* Testimonials */}
      <TestimonialCarousel testimonials={TESTIMONIALS} />

      {/* Partners */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 py-20 md:py-28">
        <SectionHeader
          eyebrow={l("landing.partnersEyebrow")}
          heading={l("landing.partnersHeading")}
          sub={l("landing.partnersBody")}
          action={{ href: "/global-collaboration", label: l("common.viewAll") }}
        />
        <div className="mt-12">
          <PartnersStrip />
        </div>
      </section>

      {/* News */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-20 md:pb-28">
        <SectionHeader
          eyebrow={l("landing.newsEyebrow")}
          heading={l("landing.newsHeading")}
          action={{ href: "/news", label: l("common.viewAll") }}
        />
        <div className="mt-10 md:mt-14 grid md:grid-cols-3 gap-5 md:gap-6">
          {articles.length > 0 ? (
            articles.map((a) => (
              <NewsCard
                key={a.slug}
                href={`/news/${a.slug}`}
                title={a.title}
                excerpt={a.excerpt}
                dateLabel={
                  a.published_at
                    ? new Date(a.published_at).toLocaleDateString(
                        locale === "zh" ? "zh-CN" : "en-GB",
                        { year: "numeric", month: "short" },
                      )
                    : null
                }
                tag={a.tags?.[0] ?? null}
                readMoreLabel={l("common.readMore")}
              />
            ))
          ) : (
            <div className="md:col-span-3 py-14 text-center text-[var(--ink-mute)] text-[14px]">
              {l("landing.newsEmpty")}
            </div>
          )}
        </div>
      </section>

      <CTABlock
        heading={l("landing.ctaBlockHeading")}
        body={l("landing.ctaBlockBody")}
        cta={{ href: "/register", label: l("landing.ctaBlockCta") }}
        secondary={{ href: "/events", label: l("landing.ctaEvents") }}
      />
    </>
  );
}
