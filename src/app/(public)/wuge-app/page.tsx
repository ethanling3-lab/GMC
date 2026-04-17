import { PagePreamble } from "@/components/marketing/PagePreamble";
import { CTABlock } from "@/components/marketing/CTABlock";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Wuge App" };

export default async function WugeAppPage() {
  const locale = await getServerLocale();

  const features = locale === "zh"
    ? [
        { lead: "每日经典", body: "一日一则精选经典，短解 + 一个可行的今日尝试。" },
        { lead: "课程回放", body: "GMC 课程的剪辑精华与同期笔记，随手可读。" },
        { lead: "师生同修", body: "与同期学员共同记录自省，老师在关键处留言。" },
      ]
    : [
        { lead: "A daily passage", body: "One classical line per day — a short gloss and one practice to try today." },
        { lead: "Course library", body: "Edited moments from GMC programmes and classmate notes, readable any time." },
        { lead: "Faculty in the margins", body: "Record your reflections alongside your cohort; faculty respond in the critical places." },
      ];

  return (
    <>
      <PagePreamble
        eyebrow={locale === "zh" ? "吴歌 APP" : "Wuge App"}
        heading={locale === "zh" ? "把学堂放进口袋。" : "The studio, in your pocket."}
        sub={locale === "zh"
          ? "吴歌 APP 是 GMC 学员日常修习的陪伴。每日一则经典、课程回放、与同期的笔记交流——把学堂带进生活。"
          : "Wuge is the companion to your daily practice — a daily line from the classics, course replays, and notes with your cohort."}
      />

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-16">
        <div className="flex flex-wrap gap-3">
          <a
            href="#"
            className="inline-flex items-center gap-3 h-12 px-6 bg-[var(--ink)] text-[var(--paper-warm)] text-[13px] font-semibold tracking-[0.12em] uppercase
                       transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                       hover:-translate-y-[1px] hover:shadow-[var(--shadow-paper-2)]
                       active:translate-y-0"
          >
            App Store
            <span aria-hidden="true" className="w-4 h-px bg-current" />
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-3 h-12 px-6 border border-[var(--ink)] text-[var(--ink)] text-[13px] font-semibold tracking-[0.12em] uppercase
                       transition-[background-color,color,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                       hover:bg-[var(--ink)] hover:text-[var(--paper-warm)]"
          >
            Google Play
          </a>
        </div>
        <p className="mt-4 text-[12px] text-[var(--ink-mute)]">
          {locale === "zh"
            ? "下载链接待发布。若希望第一时间收到通知，请先完成报名。"
            : "Download links coming soon. Register to be notified first."}
        </p>
      </section>

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-24">
        <div className="rule-notch mb-12" aria-hidden="true"><span className="mark" /></div>
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={i} className="bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-7 shadow-[var(--shadow-paper-1)]">
              <span className="font-display text-[13px] tracking-[0.24em] text-[var(--cinnabar)]">
                — {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-5 font-display text-[22px] leading-[1.3] text-[var(--ink)]">{f.lead}</h3>
              <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <CTABlock
        heading={locale === "zh" ? "想参与 Beta 测试？" : "Want to join the beta?"}
        body={locale === "zh" ? "提交报名表时，请在「备注」里注明愿意参与 Beta。我们将优先通知。" : "Note in your registration that you'd like to join the beta — you'll be notified first."}
        cta={{ href: "/register", label: locale === "zh" ? "立即报名" : "Register" }}
      />
    </>
  );
}
