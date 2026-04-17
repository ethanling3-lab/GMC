import { PagePreamble } from "@/components/marketing/PagePreamble";
import { CTABlock } from "@/components/marketing/CTABlock";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";

export const metadata = { title: "About" };

// The narrative below uses verbatim English text from gmcglobal.com/aboutus.
// ZH translation is Ethan's version — flagged in the plan for his review.

const ABOUT = {
  en: {
    intro:
      "Glorious Melodies Culture Education Singapore (GMC), headquartered in Singapore, is a globally oriented institution dedicated to educational and cultural innovation. Based in Asia and connected to the world, GMC's mission is to advance educational innovation, foster humanistic exchange, and promote cross-cultural collaboration — bringing wisdom, inspiration, and hope to learners everywhere.",
    introCont:
      "GMC integrates the profound heritage of Eastern culture with the structure and rigour of Western education. Through international partnerships, academic exchanges, and cultural dialogue, we offer programs including Philosophy of Humanities and Management Series, Youth Development, and Future-oriented Vocational Skills Training. Through these diverse initiatives, GMC supports learners in achieving growth and excellence across multiple dimensions — physical and mental well-being, family life, career development, and contributions to society.",
    founderEyebrow: "Founder · Dr Eric Wu",
    founderTitle: "Founder of Glorious Melodies Culture (GMC) – Dr. Eric Wu",
    founderRoles: [
      "Dean, International Institute of Online Education (IIOE) Singapore",
      "International Education Consultant, UNESCO-ICHEI",
    ],
    founderBio1:
      "Dr Wu holds a bachelor's degree in clinical medicine and an honorary doctorate. He advocates a holistic health philosophy integrating nutrition, exercise, sleep, emotional wellbeing, and mental wisdom. With expertise in both traditional Chinese and Western medicine, he also focuses on cross-cultural integrative education.",
    founderBio2:
      "He has initiated multiple international programmes. In 2016, with support from the Mexican government, he led a nationwide initiative across 170,000 schools promoting healthy eating and emotional education to tackle obesity and bullying. In 2025, he partnered with Malaysia's Ministry of Education to digitally upgrade 74 primary schools in Perlis, enhancing student engagement.",
    founderBio3:
      "For his contributions to traditional medicine and educational innovation, he received UNESCO–ICHCAP's Traditional Medicine Contribution Award. He currently serves as International Education Consultant to UNESCO–ICHEI and Dean of the International Institute of Online Education (IIOE) Singapore.",
  },
  zh: {
    intro:
      "Glorious Melodies Culture Education Singapore（简称 GMC）总部位于新加坡，是一所立足亚洲、面向全球的教育与文化创新机构。GMC 致力于推动教育创新、促进人文交流与跨文化合作，为世界各地的学员带去智慧、启发与希望。",
    introCont:
      "GMC 将东方文化的深厚底蕴与西方教育的结构与严谨相融合。通过国际合作、学术交流与文化对话，我们开设「人文哲学与管理系列」「青少年成长计划」与「面向未来的职业技能培训」等课程；支持学员在身心健康、家庭生活、职业发展与社会贡献等多个层面实现成长与卓越。",
    founderEyebrow: "创始人 · 吴博士",
    founderTitle: "Glorious Melodies Culture（GMC）创始人 · 吴博士（Dr. Eric Wu）",
    founderRoles: [
      "新加坡 IIOE 国际在线教育研究院院长",
      "联合国教科文组织高等教育创新中心（UNESCO-ICHEI）国际教育顾问",
    ],
    founderBio1:
      "吴博士拥有临床医学学士学位与荣誉博士学位。他倡导将营养、运动、睡眠、情绪健康与心性智慧整合为一的整体健康理念；在传统中医与西方医学领域皆具备专业背景，并长期聚焦跨文化整合教育。",
    founderBio2:
      "他曾发起并主导多项国际教育项目。2016 年，在墨西哥政府的支持下，他牵头推动覆盖全国 170,000 所学校的倡议，以健康饮食与情绪教育为切入点，应对肥胖与校园霸凌问题。2025 年，他与马来西亚教育部合作，为玻璃市州 74 所小学开展数字化升级，提升学生参与度。",
    founderBio3:
      "因其在传统医学与教育创新方面的贡献，他荣获 UNESCO–ICHCAP 传统医学贡献奖。他目前担任 UNESCO–ICHEI 国际教育顾问，以及新加坡 IIOE 国际在线教育研究院院长。",
  },
};

export default async function AboutPage() {
  const locale = await getServerLocale();
  const d = getDict(locale);
  const l = (p: string, f?: string) => t(d, p, f);
  const copy = ABOUT[locale];

  return (
    <>
      <PagePreamble
        eyebrow={l("about.eyebrow")}
        heading={locale === "zh" ? "让经典走入日常，让教育唤醒生命。" : "Bring the classics into daily life; awaken lives through education."}
        sub={l("landing.heroHeading").replace("\n", " · ")}
      />

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-16 md:pb-20">
        <p className="text-[17px] md:text-[18px] leading-[1.8] text-[var(--ink-soft)] max-w-[820px]">
          {copy.intro}
        </p>
        <p className="mt-6 text-[16px] leading-[1.8] text-[var(--ink-soft)] max-w-[820px]">
          {copy.introCont}
        </p>
      </section>

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-20 md:pb-28">
        <div className="rule-notch mb-14" aria-hidden="true"><span className="mark" /></div>

        <div className="grid md:grid-cols-[280px_1fr] gap-10 md:gap-16 items-start">
          <div>
            <span className="eyebrow">{copy.founderEyebrow}</span>
            <h2 className="mt-5 font-display text-[32px] md:text-[40px] leading-[1.1] tracking-[-0.02em] text-[var(--ink)]">
              {copy.founderTitle}
            </h2>
            <ul className="mt-8 flex flex-col gap-3 text-[13px] leading-[1.6] text-[var(--ink-mute)]">
              {copy.founderRoles.map((role, i) => (
                <li key={i} className="flex gap-3">
                  <span aria-hidden="true" className="w-4 h-px mt-2.5 bg-[var(--cinnabar)] flex-none" />
                  <span>{role}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-6 text-[16px] leading-[1.8] text-[var(--ink-soft)]">
            <p>{copy.founderBio1}</p>
            <p>{copy.founderBio2}</p>
            <p>{copy.founderBio3}</p>
          </div>
        </div>
      </section>

      <CTABlock
        heading={locale === "zh" ? "想更深入地了解我们" : "Want to know more?"}
        body={locale === "zh" ? "从一次课程开始。" : "Begin with a programme."}
        cta={{ href: "/programs", label: l("landing.ctaPrograms") }}
        secondary={{ href: "/register", label: l("landing.ctaRegister") }}
      />
    </>
  );
}
