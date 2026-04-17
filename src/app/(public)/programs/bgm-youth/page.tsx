import { ProgramDetail } from "../ProgramDetail";
import { PROGRAM_CONTENT } from "../program-data";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "BGM Youth Development" };

export default async function Page() {
  const locale = await getServerLocale();
  return (
    <ProgramDetail
      content={PROGRAM_CONTENT.bgm[locale]}
      locale={locale}
      ctaLabel={locale === "zh" ? "立即报名" : "Register"}
      secondaryLabel={locale === "zh" ? "返回课程列表" : "All programs"}
    />
  );
}
