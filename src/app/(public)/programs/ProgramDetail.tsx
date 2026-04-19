import Image from "next/image";
import Link from "next/link";
import { PagePreamble } from "@/components/marketing/PagePreamble";
import { CTABlock } from "@/components/marketing/CTABlock";

export type ProgramContent = {
  eyebrow: string;
  heading: string;
  sub: string;
  intro: string;
  bullets: { lead: string; body: string }[];
  duration: string;
  audience: string;
  mode: string;
};

export type ProgramHeroImage = {
  src: string;
  alt: string;
  captionZh?: string;
  captionEn?: string;
};

export function ProgramDetail({ content, locale, ctaLabel, secondaryLabel, heroImage }: {
  content: ProgramContent;
  locale: "zh" | "en";
  ctaLabel: string;
  secondaryLabel: string;
  heroImage?: ProgramHeroImage;
}) {
  return (
    <>
      <PagePreamble
        eyebrow={content.eyebrow}
        heading={content.heading}
        sub={content.sub}
      />

      {heroImage ? (
        <section className="mx-auto max-w-[1200px] px-6 md:px-10 pb-16 md:pb-20">
          <figure className="relative">
            <div className="relative aspect-[16/9] md:aspect-[21/9] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--ink)] shadow-[var(--shadow-paper-2)]">
              <Image
                src={heroImage.src}
                alt={heroImage.alt}
                fill
                sizes="(min-width: 1200px) 1120px, 100vw"
                className="object-cover"
                priority
              />
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(11,41,84,0) 55%, rgba(11,41,84,0.55) 100%)",
                }}
              />
            </div>
            {(heroImage.captionZh || heroImage.captionEn) ? (
              <figcaption className="mt-4 flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                <span className="w-6 h-px bg-[var(--cinnabar)]" />
                {locale === "zh" ? (heroImage.captionZh ?? heroImage.captionEn) : (heroImage.captionEn ?? heroImage.captionZh)}
              </figcaption>
            ) : null}
          </figure>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-16">
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-12">
          <dl className="flex flex-col gap-6 text-[13px]">
            <MetaRow label={locale === "zh" ? "课程时长" : "Duration"} value={content.duration} />
            <MetaRow label={locale === "zh" ? "适合对象" : "Audience"}  value={content.audience} />
            <MetaRow label={locale === "zh" ? "授课形式" : "Mode"}      value={content.mode} />
          </dl>
          <div>
            <p className="text-[16px] md:text-[17px] leading-[1.8] text-[var(--ink-soft)]">
              {content.intro}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-6 md:px-10 pb-20 md:pb-28">
        <div className="rule-notch mb-12" aria-hidden="true"><span className="mark" /></div>
        <div className="grid gap-10 md:gap-14">
          {content.bullets.map((b, i) => (
            <div key={i} className="grid md:grid-cols-[120px_1fr] gap-4 md:gap-10 items-start">
              <div className="font-display text-[20px] md:text-[26px] text-[var(--cinnabar)] tracking-[-0.01em]">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div>
                <h3 className="font-display text-[22px] md:text-[26px] leading-[1.25] text-[var(--ink)]">
                  {b.lead}
                </h3>
                <p className="mt-4 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[640px]">
                  {b.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <CTABlock
        heading={locale === "zh" ? "准备好加入了吗？" : "Ready to register?"}
        body={locale === "zh" ? "填写报名表后，我们的客服将与你进一步联络。" : "Our team will follow up once you complete the form."}
        cta={{ href: "/register", label: ctaLabel }}
        secondary={{ href: "/programs", label: secondaryLabel }}
      />
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">{label}</dt>
      <dd className="mt-2 font-display text-[17px] text-[var(--ink)] leading-[1.4]">{value}</dd>
    </div>
  );
}
