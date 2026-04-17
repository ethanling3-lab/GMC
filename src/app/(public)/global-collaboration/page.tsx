import { PagePreamble } from "@/components/marketing/PagePreamble";
import { CTABlock } from "@/components/marketing/CTABlock";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Global Collaboration" };

// Intro, partner list, and initiatives below are the verbatim English wording from
// gmcglobal.com/copy-of-国际合作. ZH is Ethan's translation.

export default async function GlobalCollaborationPage() {
  const locale = await getServerLocale();

  const intro = locale === "zh"
    ? "这些合作项目旨在培养具备跨文化沟通能力、专业技能，以及能够在国际舞台上创新与引领的国际化人才。"
    : "These collaborative initiatives aim to nurture internationally competitive students with cross-cultural communication abilities, technical expertise, and the capacity to innovate and lead on the global stage.";

  const partners = locale === "zh"
    ? [
        { name: "UNESCO ICHEI", subtitle: "联合国教科文组织高等教育创新中心" },
        { name: "Brest Business School", subtitle: "法国布雷斯特商学院" },
        { name: "Sungkyunkwan University", subtitle: "韩国成均馆大学" },
        { name: "Yonsei University", subtitle: "韩国延世大学" },
        { name: "Singapore Management University (SMU)", subtitle: "新加坡管理大学 · 自 2022 年设立为期五年的奖学金项目" },
      ]
    : [
        { name: "UNESCO ICHEI", subtitle: "UNESCO Higher Education Innovation Center" },
        { name: "Brest Business School", subtitle: "France" },
        { name: "Sungkyunkwan University", subtitle: "Republic of Korea" },
        { name: "Yonsei University", subtitle: "Republic of Korea" },
        { name: "Singapore Management University (SMU)", subtitle: "A five-year GMC Scholarship established in 2022" },
      ];

  const initiatives = locale === "zh"
    ? [
        {
          title: "联合研究院",
          body: "围绕财富管理、医疗健康、哲学、人文心理学等重点领域，建立跨学科研究机构。",
        },
        {
          title: "哲学与管理课程",
          body: "在财富管理、心理健康、健康哲学、人文哲学等领域开设课程。",
        },
        {
          title: "学术与文化交流",
          body: "与全球高校开展心理健康、人文关怀、医学伦理与财富哲学等领域的学术交流。",
        },
        {
          title: "GMC · SMU 奖学金",
          body: "旨在激励就读于新加坡管理大学计算机与信息系统学院的优秀本科生。",
        },
      ]
    : [
        {
          title: "Joint Research Institutes",
          body: "Establish interdisciplinary research institutes focused on key areas such as wealth management, healthcare, philosophy, and humanistic psychology.",
        },
        {
          title: "Philosophy & Management Courses",
          body: "Programs in fields such as wealth management, mental health, health philosophy, and humanistic philosophy.",
        },
        {
          title: "Academic and Cultural Exchanges",
          body: "Academic exchanges with global universities in areas such as mental health, humanistic care, medical ethics, and the philosophy of wealth.",
        },
        {
          title: "GMC Scholarship at SMU",
          body: "Aims to inspire outstanding undergraduates enrolled in the School of Computing and Information Systems at SMU.",
        },
      ];

  return (
    <>
      <PagePreamble
        eyebrow={locale === "zh" ? "国际合作" : "Global Collaboration"}
        heading={locale === "zh" ? "与世界一流大学共建的合作项目" : "Collaborative Projects with World-Class Universities"}
        sub={intro}
      />

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-20 md:pb-28">
        <div className="rule-notch mb-12" aria-hidden="true"><span className="mark" /></div>

        <div className="grid md:grid-cols-[1fr_1.4fr] gap-12 md:gap-20">
          <div>
            <span className="eyebrow">{locale === "zh" ? "合作伙伴" : "Partners"}</span>
          </div>
          <ul className="flex flex-col gap-8">
            {partners.map((p, i) => (
              <li
                key={p.name}
                className={`flex flex-col gap-1 pb-7 ${i < partners.length - 1 ? "border-b border-[var(--paper-shadow)]" : ""}`}
              >
                <div className="font-display text-[22px] md:text-[26px] leading-[1.25] text-[var(--ink)]">
                  {p.name}
                </div>
                <div className="text-[12px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                  {p.subtitle}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-24">
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-12 md:gap-20">
          <div>
            <span className="eyebrow">{locale === "zh" ? "合作方向" : "Initiatives"}</span>
          </div>
          <div className="grid gap-8 md:gap-10">
            {initiatives.map((it, i) => (
              <article key={i} className="grid grid-cols-[48px_1fr] gap-5">
                <span className="font-display text-[13px] tracking-[0.22em] text-[var(--cinnabar)] pt-1">
                  — {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-display text-[20px] md:text-[22px] leading-[1.25] text-[var(--ink)]">
                    {it.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[560px]">
                    {it.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CTABlock
        heading={locale === "zh" ? "合作共建，欢迎洽谈。" : "Interested in collaborating?"}
        body={locale === "zh"
          ? "无论是学术机构、企业单位或政府组织，我们都欢迎探索更深入的合作方式。"
          : "Academic institutions, organisations, or governments — we welcome deeper conversations."}
        cta={{ href: "/register", label: locale === "zh" ? "取得联络" : "Get in touch" }}
      />
    </>
  );
}
