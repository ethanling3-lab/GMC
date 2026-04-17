// M1 placeholder testimonials. Replace with real participant voices + photos
// before public launch. Move to a Supabase `testimonials` table in a later milestone
// when Ethan wants CMS control.

export type Testimonial = {
  id: string;
  quote: { zh: string; en: string };
  name: string;           // shown in both locales
  role: { zh: string; en: string };
  region_id?: string;     // GMC region ID if ever referenced externally
  avatar?: string;        // path under /public; optional, falls back to initial mark
};

export const TESTIMONIALS: Testimonial[] = [
  {
    id: "t-mh-2025",
    quote: {
      zh: "课堂上读过的几段经典，在这半年里一次次回来。它们不再是考题，而是我在决策时心里那把尺子。",
      en: "A few passages I read in class kept coming back over the last six months. They stopped being exam material — they became the ruler in my head when I had to decide.",
    },
    name: "M.H.",
    role: {
      zh: "企业家班 · 2024 期",
      en: "Business Program · Cohort 2024",
    },
  },
  {
    id: "t-syl-2025",
    quote: {
      zh: "孩子参加完 BGM 之后最大的变化，不是背了多少经典，而是他愿意主动和我们谈他的一天。",
      en: "The real change after BGM wasn't how many classics my child could recite — it was that he started, on his own, telling us about his day.",
    },
    name: "S.Y.L.",
    role: {
      zh: "BGM 少年班家长",
      en: "BGM Youth · parent",
    },
  },
  {
    id: "t-kc-2026",
    quote: {
      zh: "四天的静修结束后，我回办公室第一件事是把会议议程砍掉一半。那是吴博士反复讲的「止」的意思。",
      en: "The first thing I did after returning from the four-day retreat was cut my meeting agenda in half. That was what Dr Wu meant by 'rest at the highest good.'",
    },
    name: "K.C.",
    role: {
      zh: "经典与修心 · 槟城 2026",
      en: "Penang Retreat · Spring 2026",
    },
  },
];
