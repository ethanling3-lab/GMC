import Image from "next/image";
import Link from "next/link";
import { PagePreamble } from "@/components/marketing/PagePreamble";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Events" };
export const revalidate = 60;

async function loadOpenEvents(locale: "zh" | "en") {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("events")
      .select(
        "slug, title_cn, title_en, heading_cn, heading_en, poster_url, city, country, start_date, end_date, arrival_day, departure_day, type, mode, status, requires_approval",
      )
      .eq("status", "open")
      .order("start_date", { ascending: true });
    if (error || !data) return [];
    return data.map((e) => ({
      ...e,
      title: (locale === "zh" ? e.title_cn : e.title_en) ?? e.title_en ?? e.title_cn ?? e.slug,
      heading: (locale === "zh" ? e.heading_cn : e.heading_en) ?? null,
    }));
  } catch {
    return [];
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

export default async function EventsPage() {
  const locale = await getServerLocale();
  const events = await loadOpenEvents(locale);

  return (
    <>
      <PagePreamble
        eyebrow={locale === "zh" ? "活动" : "Events"}
        heading={locale === "zh" ? "近期活动与报名信息。" : "What's currently open."}
        sub={locale === "zh" ? "查看近期开放报名的课程、工作坊与静修活动。" : "Browse upcoming courses, workshops, and retreats."}
      />

      <section className="mx-auto max-w-[1200px] px-6 md:px-10 pb-16 md:pb-20">
        <figure className="relative">
          <div className="relative aspect-[16/9] md:aspect-[21/9] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--ink)] shadow-[var(--shadow-paper-2)]">
            <Image
              src="/hero-bg.jpg"
              alt={locale === "zh" ? "《永不落空的力量》· Grand Hyatt 站" : "The Infallible Power — at Grand Hyatt"}
              fill
              sizes="(min-width: 1200px) 1120px, 100vw"
              className="object-cover"
              priority
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, rgba(11,41,84,0) 55%, rgba(11,41,84,0.55) 100%)",
              }}
            />
          </div>
          <figcaption className="mt-4 flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            <span className="w-6 h-px bg-[var(--cinnabar)]" />
            {locale === "zh" ? "《永不落空的力量》· Grand Hyatt 站" : "The Infallible Power · Grand Hyatt"}
          </figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-24">
        {events.length === 0 ? (
          <div className="py-16 text-center text-[var(--ink-mute)] bg-[var(--paper-warm)] border border-dashed border-[var(--paper-shadow)]">
            <p className="text-[16px]">{locale === "zh" ? "目前暂无对外开放的活动。" : "No events are open for registration right now."}</p>
            <p className="mt-3 text-[13px]">
              {locale === "zh" ? "有问题？请先" : "Have a question? "}
              <Link href="/register" className="text-[var(--cinnabar)] underline underline-offset-4">
                {locale === "zh" ? "填写报名意向表" : "drop us a line"}
              </Link>
              {locale === "zh" ? "，我们会与你联系。" : " — we'll be in touch."}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5 md:gap-6">
            {events.map((e, i) => {
              const programRange = fmtRange(e.start_date, e.end_date, locale);
              const arrivalTxt = fmtDate(e.arrival_day, locale);
              const departureTxt = fmtDate(e.departure_day, locale);
              return (
                <article
                  key={e.slug}
                  className="group flex flex-col bg-[var(--paper-warm)] border border-[var(--paper-shadow)]
                             shadow-[var(--shadow-paper-1)]
                             transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                             hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)]
                             overflow-hidden"
                >
                  <div className="relative aspect-[16/9] bg-[var(--paper-deep)] overflow-hidden">
                    {e.poster_url ? (
                      <Image
                        src={e.poster_url}
                        alt={e.title}
                        fill
                        sizes="(min-width: 1280px) 624px, (min-width: 768px) 50vw, 100vw"
                        className="object-cover transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] group-hover:scale-[1.02]"
                        unoptimized
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0"
                        style={{
                          background:
                            "radial-gradient(540px 340px at 50% 30%, rgba(37,99,235,0.08), transparent 65%)," +
                            "linear-gradient(180deg, var(--paper) 0%, var(--paper-deep) 100%)",
                        }}
                      />
                    )}
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 mix-blend-multiply"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(11,41,84,0) 55%, rgba(11,41,84,0.45) 100%)",
                      }}
                    />
                  </div>

                  <div className="flex flex-col flex-1 p-7 md:p-8">
                  <span className="font-display text-[13px] tracking-[0.24em] text-[var(--cinnabar)]">
                    — {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-4 font-display text-[26px] leading-[1.2] text-[var(--ink)]">
                    {e.title}
                  </h3>
                  {e.heading ? (
                    <p className="mt-3 text-[15px] leading-[1.7] text-[var(--ink-soft)]">
                      {e.heading}
                    </p>
                  ) : null}

                  {programRange || arrivalTxt || departureTxt ? (
                    <dl className="mt-6 border-t border-[var(--paper-shadow)] pt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5">
                      {programRange ? (
                        <>
                          <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] self-center">
                            {locale === "zh" ? "行程 · Program" : "Program · 行程"}
                          </dt>
                          <dd className="text-[13px] tabular-nums text-[var(--ink)] self-center">
                            {programRange}
                          </dd>
                        </>
                      ) : null}
                      {arrivalTxt ? (
                        <>
                          <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] self-center">
                            {locale === "zh" ? "抵场 · Arrival" : "Arrival · 抵场"}
                          </dt>
                          <dd className="text-[13px] tabular-nums text-[var(--ink-soft)] self-center">
                            {arrivalTxt}
                          </dd>
                        </>
                      ) : null}
                      {departureTxt ? (
                        <>
                          <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] self-center">
                            {locale === "zh" ? "离场 · Departure" : "Departure · 离场"}
                          </dt>
                          <dd className="text-[13px] tabular-nums text-[var(--ink-soft)] self-center">
                            {departureTxt}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                    {e.city ? <span>{e.city}</span> : null}
                    {e.city && e.mode ? (
                      <span
                        className="w-1 h-1 rounded-full bg-[var(--paper-shadow)]"
                        aria-hidden="true"
                      />
                    ) : null}
                    {e.mode ? (
                      <span>
                        {e.mode === "online"
                          ? locale === "zh"
                            ? "线上"
                            : "Online"
                          : locale === "zh"
                            ? "实体"
                            : "Offline"}
                      </span>
                    ) : null}
                  </div>

                  {e.requires_approval ? (
                    <p className="mt-5 pt-4 border-t border-dashed border-[var(--paper-shadow)] text-[11.5px] leading-[1.6] italic text-[var(--ink-faint)]">
                      {locale === "zh"
                        ? "需审批 · 报名将由团队审核后再发确认。"
                        : "Requires approval · enrolments are reviewed before confirmation."}
                    </p>
                  ) : null}

                  <div className="mt-auto pt-6">
                    <Link
                      href={`/register?event=${encodeURIComponent(e.slug)}`}
                      className="group/cta inline-flex items-center gap-2 h-11 px-5 rounded-[var(--radius-pill)]
                                 bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] text-[var(--paper-warm)]
                                 text-[12.5px] tracking-[0.06em] font-medium
                                 shadow-[0_4px_14px_rgba(193,34,34,0.22)]
                                 focus-visible:shadow-[var(--shadow-focus)]
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
                        className="transition-transform duration-[var(--dur-fast)] group-hover/cta:translate-x-0.5"
                      >
                        <path d="M3 7h8M7.5 3l4 4-4 4" />
                      </svg>
                    </Link>
                  </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
