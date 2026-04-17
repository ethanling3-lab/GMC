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
      .select("slug, title_cn, title_en, heading_cn, heading_en, poster_url, city, country, start_date, end_date, type, mode, status")
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
            {events.map((e, i) => (
              <Link
                key={e.slug}
                href={`/events/${e.slug}`}
                className="group flex flex-col bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-7 md:p-8
                           shadow-[var(--shadow-paper-1)]
                           transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                           hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)]"
              >
                <span className="font-display text-[13px] tracking-[0.24em] text-[var(--cinnabar)]">
                  — {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 font-display text-[26px] leading-[1.2] text-[var(--ink)]">{e.title}</h3>
                {e.heading ? (
                  <p className="mt-3 text-[15px] leading-[1.7] text-[var(--ink-soft)]">{e.heading}</p>
                ) : null}
                <div className="mt-6 flex flex-wrap items-center gap-4 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                  {e.start_date ? (
                    <span>
                      {new Date(e.start_date).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  ) : null}
                  {e.city ? (
                    <>
                      <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" />
                      <span>{e.city}</span>
                    </>
                  ) : null}
                  {e.mode ? (
                    <>
                      <span className="w-1 h-1 rounded-full bg-[var(--paper-shadow)]" />
                      <span>{e.mode}</span>
                    </>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
