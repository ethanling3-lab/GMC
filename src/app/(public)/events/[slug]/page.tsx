import Link from "next/link";
import { notFound } from "next/navigation";
import { PosterSlideshow } from "@/components/marketing/PosterSlideshow";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";
import { TYPE_LABEL } from "@/lib/events-shared";
import { lowestTierAmount, type PriceTier } from "@/lib/pricing/tiers";

export const revalidate = 60;

type PageProps = { params: Promise<{ slug: string }> };

type EventRow = {
  slug: string;
  title_cn: string | null;
  title_en: string | null;
  heading_cn: string | null;
  heading_en: string | null;
  sub_heading_cn: string | null;
  sub_heading_en: string | null;
  body_cn: string | null;
  body_en: string | null;
  poster_url: string | null;
  gallery: string[] | null;
  type: "retreat" | "course" | "single_class" | "delivery_class" | "other";
  mode: "online" | "offline";
  venue: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  arrival_day: string | null;
  departure_day: string | null;
  enrollment_closes_at: string | null;
  capacity: number | null;
  price: number | string | null;
  price_tiers?: PriceTier[] | null;
  currency: string | null;
  status: string;
  requires_approval: boolean;
};

async function loadEvent(slug: string): Promise<EventRow | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const base =
      "slug, title_cn, title_en, heading_cn, heading_en, sub_heading_cn, sub_heading_en, body_cn, body_en, poster_url, gallery, type, mode, venue, city, country, start_date, end_date, arrival_day, departure_day, enrollment_closes_at, capacity, price, currency, status, requires_approval";
    let res = await supabase
      .from("events")
      .select(`${base}, price_tiers`)
      .eq("slug", slug)
      .eq("status", "open")
      .maybeSingle();
    // Pre-042 fallback — drop price_tiers if the column doesn't exist yet.
    if (res.error && (res.error as { code?: string }).code === "42703") {
      res = await supabase
        .from("events")
        .select(base)
        .eq("slug", slug)
        .eq("status", "open")
        .maybeSingle();
    }
    if (res.error || !res.data) return null;
    return res.data as EventRow;
  } catch {
    return null;
  }
}

function fmtDate(iso: string | null, locale: "zh" | "en"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtRange(
  start: string | null,
  end: string | null,
  locale: "zh" | "en",
): string | null {
  const s = fmtDate(start, locale);
  const e = fmtDate(end, locale);
  if (s && e && s !== e) return `${s} → ${e}`;
  return s ?? e;
}

function fmtPrice(
  price: number | string | null,
  currency: string | null,
  locale: "zh" | "en",
): string | null {
  if (price === null || price === undefined) return null;
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return null;
  if (n === 0) return locale === "zh" ? "免费" : "Complimentary";
  try {
    return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-SG", {
      style: "currency",
      currency: currency ?? "SGD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency ?? "SGD"} ${n.toLocaleString()}`;
  }
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return { title: "Events" };
  return {
    title:
      event.title_en ??
      event.title_cn ??
      event.heading_en ??
      event.heading_cn ??
      "Event",
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const [locale, { slug }] = await Promise.all([getServerLocale(), params]);
  const event = await loadEvent(slug);
  if (!event) notFound();

  const title =
    (locale === "zh" ? event.title_cn : event.title_en) ??
    event.title_en ??
    event.title_cn ??
    event.slug;
  const altTitle = locale === "zh" ? event.title_en : event.title_cn;

  const heading =
    (locale === "zh" ? event.heading_cn : event.heading_en) ?? null;
  const subHeading =
    (locale === "zh" ? event.sub_heading_cn : event.sub_heading_en) ?? null;
  const body = (locale === "zh" ? event.body_cn : event.body_en) ?? "";
  const altBody = (locale === "zh" ? event.body_en : event.body_cn) ?? "";

  const gallery = event.gallery ?? [];
  const heroImages =
    gallery.length > 0
      ? gallery
      : event.poster_url
        ? [event.poster_url]
        : [];

  const programRange = fmtRange(event.start_date, event.end_date, locale);
  const arrivalTxt = fmtDate(event.arrival_day, locale);
  const departureTxt = fmtDate(event.departure_day, locale);
  const deadlineTxt = event.enrollment_closes_at
    ? new Date(event.enrollment_closes_at).toLocaleDateString(
        locale === "zh" ? "zh-CN" : "en-GB",
        { year: "numeric", month: "short", day: "numeric" },
      )
    : null;

  const venueLine = [event.venue, event.city, event.country]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join(" · ");

  const modeTxt =
    event.mode === "online"
      ? locale === "zh"
        ? "线上直播"
        : "Online"
      : locale === "zh"
        ? "实体课程"
        : "In person";

  const typeTxt = TYPE_LABEL[event.type][locale];
  // With tiered pricing, show "from <lowest tier>" since the exact amount
  // depends on the participant's tier (resolved at checkout).
  const lowest = lowestTierAmount(event);
  const priceTxt =
    lowest != null
      ? locale === "zh"
        ? `${fmtPrice(lowest, event.currency, locale)} 起`
        : `from ${fmtPrice(lowest, event.currency, locale)}`
      : fmtPrice(event.price, event.currency, locale);
  const capacityTxt =
    event.capacity && event.capacity > 0
      ? locale === "zh"
        ? `${event.capacity} 位`
        : `${event.capacity} seats`
      : null;

  type SpecRow = { label: string; value: string };
  const specs: SpecRow[] = [];
  if (programRange)
    specs.push({
      label: locale === "zh" ? "行程 · Program" : "Program · 行程",
      value: programRange,
    });
  if (arrivalTxt)
    specs.push({
      label: locale === "zh" ? "抵场 · Arrival" : "Arrival · 抵场",
      value: arrivalTxt,
    });
  if (departureTxt)
    specs.push({
      label: locale === "zh" ? "离场 · Departure" : "Departure · 离场",
      value: departureTxt,
    });
  if (venueLine)
    specs.push({
      label: locale === "zh" ? "地点 · Venue" : "Venue · 地点",
      value: venueLine,
    });
  specs.push({
    label: locale === "zh" ? "形式 · Mode" : "Mode · 形式",
    value: `${modeTxt} · ${typeTxt}`,
  });
  if (capacityTxt)
    specs.push({
      label: locale === "zh" ? "名额 · Capacity" : "Capacity · 名额",
      value: capacityTxt,
    });
  if (priceTxt)
    specs.push({
      label: locale === "zh" ? "费用 · Fee" : "Fee · 费用",
      value: priceTxt,
    });
  if (deadlineTxt)
    specs.push({
      label: locale === "zh" ? "截止 · Closes" : "Closes · 截止",
      value: deadlineTxt,
    });

  const registerHref = `/register?event=${encodeURIComponent(event.slug)}`;

  const bodyParagraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      {/* Back link strip */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pt-16 md:pt-20">
        <Link
          href="/events"
          className="inline-flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          <span aria-hidden="true">←</span>
          {locale === "zh" ? "返回活动列表" : "All events"}
        </Link>
      </section>

      {/* Headline — eyebrow, bilingual title, heading, sub-heading */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pt-8 md:pt-10 pb-10 md:pb-14">
        <div className="grid md:grid-cols-[1fr_auto] gap-8 md:gap-12 items-end">
          <div>
            <div className="eyebrow rise" style={{ animationDelay: "40ms" }}>
              <span>{typeTxt}</span>
              <span
                aria-hidden="true"
                className="w-1 h-1 rounded-full bg-[var(--cinnabar)] opacity-70"
              />
              <span>{modeTxt}</span>
              {event.city ? (
                <>
                  <span
                    aria-hidden="true"
                    className="w-1 h-1 rounded-full bg-[var(--cinnabar)] opacity-70"
                  />
                  <span>{event.city}</span>
                </>
              ) : null}
            </div>

            <h1
              className="mt-5 font-display text-[var(--ink)] max-w-[920px] rise"
              style={{ animationDelay: "120ms" }}
            >
              {title}
            </h1>

            {altTitle && altTitle !== title ? (
              <p
                className="mt-3 font-display text-[18px] md:text-[22px] leading-[1.35] text-[var(--ink-mute)] max-w-[820px] rise"
                style={{ animationDelay: "180ms" }}
              >
                {altTitle}
              </p>
            ) : null}

            {heading ? (
              <p
                className="mt-6 font-display text-[20px] md:text-[24px] leading-[1.5] text-[var(--ink-soft)] max-w-[760px] rise"
                style={{ animationDelay: "240ms" }}
              >
                {heading}
              </p>
            ) : null}

            {subHeading ? (
              <p
                className="mt-4 text-[15px] md:text-[16px] leading-[1.75] text-[var(--ink-mute)] max-w-[680px] rise"
                style={{ animationDelay: "300ms" }}
              >
                {subHeading}
              </p>
            ) : null}
          </div>

          <div
            className="hidden md:flex flex-col items-end gap-1 text-right rise shrink-0"
            style={{ animationDelay: "320ms" }}
          >
            {programRange ? (
              <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                {locale === "zh" ? "行程" : "When"}
              </span>
            ) : null}
            {programRange ? (
              <span className="font-display text-[20px] text-[var(--ink)] tabular-nums">
                {programRange}
              </span>
            ) : null}
            {venueLine ? (
              <span className="mt-3 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                {locale === "zh" ? "地点" : "Where"}
              </span>
            ) : null}
            {venueLine ? (
              <span className="font-display text-[17px] text-[var(--ink-soft)] leading-[1.4] max-w-[320px]">
                {venueLine}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Hero slideshow */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-16 md:pb-20">
        <PosterSlideshow
          images={heroImages}
          alt={title}
          captionZh={event.title_cn ?? event.heading_cn}
          captionEn={event.title_en ?? event.heading_en}
          locale={locale}
        />
      </section>

      {/* Specs + body */}
      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-20 md:pb-24">
        <div className="grid md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr] gap-12 md:gap-16">
          {/* At-a-glance specs rail */}
          <aside className="md:sticky md:top-24 self-start">
            <div
              className="relative bg-[var(--paper-warm)] border border-[var(--paper-shadow)] shadow-[var(--shadow-paper-1)] rounded-[var(--radius-lg)] p-7"
            >
              <div
                aria-hidden="true"
                className="absolute -top-px left-8 right-8 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--cinnabar), transparent)",
                }}
              />
              <span className="eyebrow">
                {locale === "zh" ? "一览" : "At a glance"}
              </span>

              <dl className="mt-6 flex flex-col gap-5">
                {specs.map((row, i) => (
                  <div key={row.label + i}>
                    <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                      {row.label}
                    </dt>
                    <dd className="mt-1.5 font-display text-[16px] leading-[1.4] text-[var(--ink)] tabular-nums">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-8 pt-6 border-t border-dashed border-[var(--paper-shadow)]">
                <Link
                  href={registerHref}
                  style={{ color: "#ffffff" }}
                  className="group w-full inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full
                             bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)]
                             text-[13px] tracking-[0.02em] font-bold
                             shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                             hover:shadow-[0_8px_22px_rgba(37,99,235,0.42)]
                             transition-[background-color,transform,box-shadow] duration-[var(--dur-fast)]
                             active:scale-[0.98]"
                >
                  {locale === "zh" ? "立即报名" : "Register now"}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
                  >
                    <path d="M3 7h8M7.5 3l4 4-4 4" />
                  </svg>
                </Link>

                {event.requires_approval ? (
                  <p className="mt-4 text-[11.5px] leading-[1.6] italic text-[var(--ink-faint)]">
                    {locale === "zh"
                      ? "需审批 · 报名将由团队审核后再发确认。"
                      : "Requires approval · enrolments are reviewed before confirmation."}
                  </p>
                ) : null}
              </div>
            </div>
          </aside>

          {/* Long-form body */}
          <article className="min-w-0">
            <div className="rule-notch mb-10" aria-hidden="true">
              <span className="mark" />
            </div>

            <span className="eyebrow">
              {locale === "zh" ? "关于本场" : "About this event"}
            </span>

            {bodyParagraphs.length > 0 ? (
              <div className="mt-8 flex flex-col gap-6 text-[16px] md:text-[17px] leading-[1.85] text-[var(--ink-soft)] max-w-[680px]">
                {bodyParagraphs.map((p, i) => (
                  <p
                    key={i}
                    className={
                      i === 0
                        ? "first-letter:font-display first-letter:text-[48px] first-letter:leading-[0.9] first-letter:text-[var(--cinnabar)] first-letter:float-left first-letter:pr-3 first-letter:pt-2"
                        : undefined
                    }
                  >
                    {p}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-8 text-[15px] italic text-[var(--ink-faint)] max-w-[680px]">
                {locale === "zh"
                  ? "详细介绍将尽快更新。如需提前了解，请联系团队。"
                  : "Full details coming soon. Reach out to our team for early information."}
              </p>
            )}

            {altBody && altBody.trim() && altBody !== body ? (
              <details className="mt-12 group">
                <summary
                  className="list-none cursor-pointer inline-flex items-center gap-3 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
                >
                  <span className="w-6 h-px bg-[var(--cinnabar)]" />
                  {locale === "zh" ? "Read in English" : "中文简介"}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
                  >
                    <path d="M2 4l3 3 3-3" />
                  </svg>
                </summary>
                <div className="mt-6 flex flex-col gap-5 text-[15px] leading-[1.8] text-[var(--ink-mute)] max-w-[680px] whitespace-pre-wrap">
                  {altBody}
                </div>
              </details>
            ) : null}

            {/* Mobile specs + CTA (rail is hidden on <md, below the body) */}
            <div className="md:hidden mt-12 pt-10 border-t border-[var(--paper-shadow)]">
              <span className="eyebrow">
                {locale === "zh" ? "一览" : "At a glance"}
              </span>
              <dl className="mt-5 grid grid-cols-1 gap-4">
                {specs.map((row, i) => (
                  <div
                    key={row.label + i}
                    className="grid grid-cols-[100px_1fr] gap-4"
                  >
                    <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] self-center">
                      {row.label}
                    </dt>
                    <dd className="font-display text-[15px] leading-[1.4] text-[var(--ink)] tabular-nums">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>
        </div>
      </section>

      {/* Final CTA pedestal */}
      <section className="relative bg-[var(--paper-deep)] border-y border-[var(--paper-shadow)] overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
        >
          <div
            className="absolute -top-24 left-[12%] w-[520px] h-[520px] rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, rgba(37,99,235,0.18), transparent 70%)",
            }}
          />
          <div
            className="absolute -bottom-32 right-[6%] w-[420px] h-[420px] rounded-full"
            style={{
              background:
                "radial-gradient(closest-side, rgba(125,164,244,0.22), transparent 70%)",
            }}
          />
        </div>
        <div className="relative mx-auto max-w-[1080px] px-6 md:px-10 py-20 md:py-24 text-center">
          <span className="eyebrow justify-center">
            {locale === "zh" ? "准备好加入了吗" : "Ready to join"}
          </span>
          <h2 className="mt-5 font-display text-[var(--ink)] max-w-[720px] mx-auto">
            {heading ??
              (locale === "zh"
                ? "填写报名信息，我们会与您联络。"
                : "Complete the form and our team will be in touch.")}
          </h2>
          <p className="mt-5 text-[15px] md:text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[560px] mx-auto">
            {event.requires_approval
              ? locale === "zh"
                ? "本次活动需审批，您的报名将由我们的团队审核后发出确认。"
                : "This event requires approval — our team will review your registration before confirming."
              : locale === "zh"
                ? "名额有限，以完成报名先后顺序为准。"
                : "Seats are allocated in the order registrations are received."}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
            <Link
              href={registerHref}
              style={{ color: "#ffffff" }}
              className="group inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-[var(--cinnabar)]
                         text-[13px] font-bold tracking-[0.02em]
                         shadow-[0_4px_14px_rgba(37,99,235,0.28)]
                         transition-[transform,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.38)]
                         active:translate-y-0"
            >
              {locale === "zh" ? "立即报名" : "Register now"}
              <span
                aria-hidden="true"
                className="w-4 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:translate-x-1"
              />
            </Link>
            <Link
              href="/events"
              className="inline-flex items-center justify-center gap-3 h-12 px-7 rounded-full bg-transparent text-[var(--ink)] text-[13px] font-medium tracking-[0.02em]
                         border border-[var(--paper-shadow)]
                         transition-[background-color,border-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:bg-[var(--paper-warm)] hover:border-[var(--ink)]"
            >
              {locale === "zh" ? "查看其他活动" : "Browse other events"}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
