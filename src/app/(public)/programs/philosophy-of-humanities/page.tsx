import { ProgramDetail } from "../ProgramDetail";
import { PROGRAM_CONTENT } from "../program-data";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Philosophy of Humanities" };

export default async function Page() {
  const locale = await getServerLocale();
  return (
    <ProgramDetail
      content={PROGRAM_CONTENT.ph[locale]}
      locale={locale}
      ctaLabel={locale === "zh" ? "立即报名" : "Register"}
      secondaryLabel={locale === "zh" ? "返回课程列表" : "All programs"}
      heroImage={{
        src: "/programs/philosophy.jpg",
        alt: "Everlasting Classics — the program reader",
        captionZh: "《经典永流传》· 读本",
        captionEn: "Everlasting Classics · the reader",
      }}
    />
  );
}
