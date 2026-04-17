import type { ProgramContent } from "./ProgramDetail";

// Program descriptions below use the verbatim English copy from gmcglobal.com.
// Chinese is Ethan's translation for the bilingual site — flagged in the plan for his review.
// Structural fields (duration / audience / mode) are best guesses until Ethan confirms.

type LocalizedContent = { zh: ProgramContent; en: ProgramContent };

export const PROGRAM_CONTENT: Record<"ph" | "bp" | "cw" | "bgm", LocalizedContent> = {
  ph: {
    zh: {
      eyebrow: "01 · 人文哲学",
      heading: "人文哲学",
      sub: "连接哲学、人文与管理的课程，培养具备批判思维、伦理行动与文化洞察力的反思型领导者。",
      intro:
        "这是一门旨在连接哲学、人文与管理三大领域的课程，致力于培养能够以批判性思维思考、以伦理方式行动、以文化洞察力领导的反思型领导者。",
      bullets: [
        { lead: "跨学科视野", body: "在哲学、人文与管理之间建立对话。" },
        { lead: "反思与行动并重", body: "以反思为起点，以伦理行动为落点。" },
        { lead: "面向全球的对话", body: "与国际伙伴机构联合开展学术交流与访问计划。" },
      ],
      duration: "待公布",
      audience: "已有专业背景的学员",
      mode: "线上 + 线下",
    },
    en: {
      eyebrow: "01 · Philosophy of Humanities",
      heading: "Philosophy of Humanities",
      sub: "A program designed to bridge the disciplines of philosophy, humanities, and management.",
      intro:
        "A program designed to bridge the disciplines of philosophy, humanities, and management. It fosters reflective leaders who can think critically, act ethically, and lead with cultural insight.",
      bullets: [
        { lead: "Interdisciplinary reach", body: "A dialogue across philosophy, humanities, and management." },
        { lead: "Reflection into action", body: "Begin with reflection; land in ethical, culturally insightful leadership." },
        { lead: "Global conversation", body: "Academic exchanges and visiting programmes with international partner institutions." },
      ],
      duration: "TBC",
      audience: "Professionals with some experience",
      mode: "Online + in-person",
    },
  },
  bp: {
    zh: {
      eyebrow: "02 · 企业家班",
      heading: "企业家班",
      sub: "以「东西方管理哲学的创造性整合」为核心，超越传统商业技能培训。",
      intro:
        "以「东西方管理哲学的创造性整合」为核心，本课程超越传统商业技能培训。我们致力于培养能够驾驭复杂局势、推动创新的领导者，共同构建融合效率、人文温度与生态智慧的新商业文明。",
      bullets: [
        { lead: "东西方融合", body: "把东方修身之道与西方管理方法放在同一桌上讨论。" },
        { lead: "超越技能层面", body: "不止于技巧——回到企业家作为一个人的根基。" },
        { lead: "新商业文明", body: "效率、人文温度与生态智慧，三者并举。" },
      ],
      duration: "待公布",
      audience: "企业创始人、高管、家族企业接班人",
      mode: "线下为主",
    },
    en: {
      eyebrow: "02 · Business Program",
      heading: "Business Program",
      sub: "With the core of 'creative integration of Eastern and Western management philosophies,' this program goes beyond conventional business skill training.",
      intro:
        "With the core of 'creative integration of Eastern and Western management philosophies,' this program goes beyond conventional business skill training. The program aims to nurture leaders capable of navigating complexity and driving innovation through building a new business civilization integrating efficiency, humanistic warmth, and ecological wisdom.",
      bullets: [
        { lead: "Eastern and Western integration", body: "Eastern cultivation and Western method at the same table." },
        { lead: "Beyond skill", body: "Not only technique — a return to the person behind the enterprise." },
        { lead: "A new business civilization", body: "Efficiency, humanistic warmth, and ecological wisdom held together." },
      ],
      duration: "TBC",
      audience: "Founders, senior leaders, family business successors",
      mode: "Primarily in-person",
    },
  },
  cw: {
    zh: {
      eyebrow: "03 · 食尚财富",
      heading: "食尚财富",
      sub: "课程面向所有年龄段，整合营养科学、糖控制实践、情绪调节与身心训练。",
      intro:
        "本课程面向所有年龄段学员。课程整合现代营养科学、糖控制实践、情绪调节与身心训练。",
      bullets: [
        { lead: "全年龄适用", body: "不设年龄门槛，欢迎各年龄层学员。" },
        { lead: "营养与糖控制", body: "融入现代营养科学与糖代谢管理。" },
        { lead: "情绪与身心训练", body: "身体与情绪同修，形成可落地的日常实践。" },
      ],
      duration: "待公布",
      audience: "全年龄段成人",
      mode: "线上 + 线下",
    },
    en: {
      eyebrow: "03 · Culinary Wealth",
      heading: "Culinary Wealth",
      sub: "Open to all age groups — integrating nutritional science, sugar control, emotional regulation, and mind-body training.",
      intro:
        "This program is open to all age groups. It integrates modern nutritional science, sugar control practices, emotional regulation, and mind-body training.",
      bullets: [
        { lead: "Open to all ages", body: "No age gate — participants of all ages are welcome." },
        { lead: "Nutrition and sugar control", body: "Built on modern nutritional science and glucose regulation." },
        { lead: "Emotional and somatic practice", body: "Body and emotion trained together, forming a practical daily routine." },
      ],
      duration: "TBC",
      audience: "Adults, any age",
      mode: "Online + in-person",
    },
  },
  bgm: {
    zh: {
      eyebrow: "04 · BGM 少年班",
      heading: "「Becoming a Future Master」少年课程（BGM）",
      sub: "为 12–18 岁青少年打造的素养课程，融合东方智慧、哲学思辨与现代领导力训练。",
      intro:
        "为 12 至 18 岁青少年量身打造的素养课程，融合东方智慧、哲学思辨与现代领导力训练。",
      bullets: [
        { lead: "东方智慧为锚", body: "从经典入手，让孩子在传统中找到当下的判断。" },
        { lead: "哲学思辨", body: "在提问中培养深入思考的习惯。" },
        { lead: "现代领导力训练", body: "把古典修养与现代领导素养结合。" },
      ],
      duration: "待公布",
      audience: "12–18 岁青少年",
      mode: "线下为主",
    },
    en: {
      eyebrow: "04 · BGM Youth Development",
      heading: "\"Becoming a Future Master\" Youth Curriculum (BGM)",
      sub: "A competency-based development program for adolescents aged 12 to 18 — Eastern wisdom, philosophical thinking, and modern leadership training.",
      intro:
        "A competency-based development program tailored for adolescents aged 12 to 18. Integrating Eastern wisdom, philosophical thinking, modern leadership training.",
      bullets: [
        { lead: "Anchored in Eastern wisdom", body: "Begin with the classics; let tradition shape judgement in the present." },
        { lead: "Philosophical thinking", body: "Inquiry as a habit of deep thought." },
        { lead: "Modern leadership training", body: "Classical cultivation paired with contemporary leadership." },
      ],
      duration: "TBC",
      audience: "Ages 12–18",
      mode: "Primarily in-person",
    },
  },
};
