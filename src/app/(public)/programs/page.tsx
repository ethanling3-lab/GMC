import { PagePreamble } from "@/components/marketing/PagePreamble";
import { ProgramCard } from "@/components/marketing/ProgramCard";
import { CTABlock } from "@/components/marketing/CTABlock";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";

export const metadata = { title: "Programs" };

export default async function ProgramsPage() {
  const locale = await getServerLocale();
  const d = getDict(locale);
  const l = (p: string, f?: string) => t(d, p, f);

  const programs = [
    { idx: "01", key: "ph",  href: "/programs/philosophy-of-humanities" },
    { idx: "02", key: "bp",  href: "/programs/business-program" },
    { idx: "03", key: "cw",  href: "/programs/culinary-wealth" },
    { idx: "04", key: "bgm", href: "/programs/bgm-youth" },
  ];

  return (
    <>
      <PagePreamble
        eyebrow={l("programs.eyebrow")}
        heading={l("programs.heading")}
        sub={l("landing.programsSub")}
      />

      <section className="mx-auto max-w-[1280px] px-6 md:px-10 pb-24 md:pb-32">
        <div className="grid sm:grid-cols-2 gap-5 md:gap-6">
          {programs.map((p) => (
            <ProgramCard
              key={p.key}
              index={p.idx}
              title={l(`programs.${p.key}.title`)}
              teaser={l(`programs.${p.key}.teaser`)}
              href={p.href}
              ctaLabel={l("common.learnMore")}
              className="min-h-[260px]"
            />
          ))}
        </div>
      </section>

      <CTABlock
        heading={l("landing.ctaBlockHeading")}
        body={l("landing.ctaBlockBody")}
        cta={{ href: "/register", label: l("landing.ctaBlockCta") }}
      />
    </>
  );
}
