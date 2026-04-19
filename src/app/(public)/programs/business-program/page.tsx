import { ProgramDetail } from "../ProgramDetail";
import { PROGRAM_CONTENT } from "../program-data";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Business Program" };

export default async function Page() {
  const locale = await getServerLocale();
  return (
    <ProgramDetail
      content={PROGRAM_CONTENT.bp[locale]}
      locale={locale}
      ctaLabel={locale === "zh" ? "立即报名" : "Register"}
      secondaryLabel={locale === "zh" ? "返回课程列表" : "All programs"}
      heroImage={{
        src: "/programs/business-program.jpg",
        alt: "The Infallible Power — at The Westin",
        captionZh: "《永不落空的力量》· Westin 站",
        captionEn: "The Infallible Power · The Westin",
      }}
    />
  );
}
