import { PagePreamble } from "@/components/marketing/PagePreamble";
import { getServerLocale } from "@/lib/locale-server";

export const metadata = { title: "Privacy Policy · 隐私政策" };

// DRAFT — describes what the CRM actually does, derived from the schema and
// the code paths that touch participant data. It has NOT been reviewed by
// anyone with legal standing. Ethan must review before this is relied upon,
// and the placeholders marked TODO below need real values.
//
// Written because Meta requires a Privacy Policy URL before an app can be
// published, and GMC had none anywhere (gmcglobal.com has no policy page).
//
// Accuracy notes for whoever revises this:
//   - facial recognition: participants.facial_recognition_consent, opt-in at
//     registration, used for check-in matching (src/lib/check-in/*)
//   - WhatsApp: messages flow through Meta's Cloud API; inbound is stored in
//     `messages` / `conversations`
//   - AI: inbound messages may be processed by Anthropic to draft or suggest
//     replies. src/lib/inbox/ai/assist.ts tokenises identifiers to region_id
//     before sending, so names/emails/phones are not passed through.
//   - payments: HitPay / Stripe hold card data; the CRM stores only status,
//     amount and a provider reference.

// Written per-locale rather than formatted: "最后更新：10 August 2026" reads as
// a machine translation, which is the last impression a privacy policy should give.
const LAST_UPDATED_EN = "10 August 2026";
const LAST_UPDATED_ZH = "2026 年 8 月 10 日";
const CONTACT_EMAIL = "info@gmcglobal.com"; // TODO: confirm the right inbox

type Row = { what: string; examples: string; why: string };

const COPY = {
  en: {
    eyebrow: "Legal",
    heading: "Privacy Policy",
    sub: "What Glorious Melodies collects, why we collect it, and who else sees it. Written to be read, not to be skimmed past.",
    updated: `Last updated ${LAST_UPDATED_EN}`,
    whoTitle: "Who this is about",
    who: "Glorious Melodies Consultancy Pte Ltd (“GMC”), a company registered in Singapore, operating educational and cultural programmes across Singapore, Malaysia, Hong Kong, Taiwan and mainland China. This policy covers the information we hold about programme participants, applicants and enquirers.",
    collectTitle: "What we collect, and why",
    rows: [
      {
        what: "Identity and contact",
        examples: "Name, email address, phone number, country or region, date of birth, gender.",
        why: "To register you for a programme, confirm your place, and contact you about it.",
      },
      {
        what: "Background",
        examples: "Occupation, industry, language preference, how you heard about us, previous programmes attended.",
        why: "To place you in an appropriate programme and group, and to run the session.",
      },
      {
        what: "Messages",
        examples: "WhatsApp conversations with us, email correspondence, and any documents or images you send.",
        why: "To answer your questions and keep a record of what was agreed.",
      },
      {
        what: "Payment records",
        examples: "Amount, currency, payment status, and a reference from our payment provider.",
        why: "To confirm your registration and keep proper financial records. We never see or store your card details.",
      },
      {
        what: "Photograph and facial data",
        examples: "A portrait photograph, and a mathematical representation of your face used for matching.",
        why: "Only if you give explicit consent, to speed up check-in at events. See below.",
      },
      {
        what: "Travel details",
        examples: "Flight numbers, arrival and departure times, hotel.",
        why: "To arrange airport transfers and accommodation where a programme includes them.",
      },
      {
        what: "Programme records",
        examples: "Attendance, group assignment, coursework you submit, and internal notes made by our team.",
        why: "To run the programme and support you through it.",
      },
    ] as Row[],
    faceTitle: "Facial recognition — opt-in, and reversible",
    face: "If you consent, we create a mathematical representation of your face from your photograph and use it to identify you at event check-in. This is optional. You can attend without it, and you can withdraw consent at any time — we will delete the facial data and check you in by name instead. We do not use it for any purpose other than check-in, and we do not share it.",
    waTitle: "WhatsApp",
    wa: "When you message us on WhatsApp, or we message you, those messages pass through Meta's WhatsApp Business Platform and are subject to Meta's own privacy terms as well as this policy. We store the conversation so our team can see the history and respond properly. You can ask us to stop messaging you at any time by replying STOP, or by telling any member of our team.",
    aiTitle: "Automated assistance",
    ai: "We use an automated assistant to help answer common questions and to suggest replies for our team. Message content may be processed by Anthropic, our AI provider, for this purpose. Before it is sent, we replace names, email addresses and phone numbers with an internal reference code, so the assistant does not receive your contact details. A person can take over the conversation at any point, and you can ask to speak to one at any time.",
    shareTitle: "Who else sees your information",
    share: "We do not sell your information, and we do not share it for advertising. We use these service providers to operate:",
    processors: [
      "Meta Platforms — WhatsApp message delivery",
      "Supabase — database and file storage",
      "Netlify — website hosting",
      "HitPay and Stripe — payment processing",
      "Anthropic — automated reply assistance",
      "Our email provider — sending confirmations and receipts",
    ],
    shareAfter:
      "We may also share information where the law requires it, or where it is necessary to run a programme you have registered for — for example giving a hotel a rooming list, or an airport transfer operator a passenger list.",
    keepTitle: "How long we keep it",
    keep: "We keep participant records for as long as you have an ongoing relationship with GMC, and afterwards for as long as we need to meet legal and accounting obligations. Facial data is deleted when you withdraw consent, or when it is no longer needed for check-in.",
    rightsTitle: "Your choices",
    rightsIntro: "You can ask us to:",
    rights: [
      "show you what information we hold about you",
      "correct anything that is wrong",
      "delete your information, where we are not required to keep it",
      "stop messaging you, on any channel",
      "withdraw your consent to facial recognition",
    ],
    rightsAfter: `Write to ${CONTACT_EMAIL} and we will respond. If you are not satisfied with how we handle your request, you may raise it with the data protection authority in your country.`,
    contactTitle: "Contact",
    contact: `Glorious Melodies Consultancy Pte Ltd, Singapore · ${CONTACT_EMAIL}`,
  },
  zh: {
    eyebrow: "法律条款",
    heading: "隐私政策",
    sub: "Glorious Melodies 收集哪些资料、为何收集，以及还有谁会看到。写来是给您读的，不是让您略过的。",
    updated: `最后更新：${LAST_UPDATED_ZH}`,
    whoTitle: "关于我们",
    who: "Glorious Melodies Consultancy Pte Ltd（简称 GMC）为新加坡注册公司，在新加坡、马来西亚、香港、台湾及中国大陆开展教育与文化课程。本政策适用于我们所持有的学员、申请人及咨询者的资料。",
    collectTitle: "我们收集什么，以及为什么",
    rows: [
      {
        what: "身份与联络方式",
        examples: "姓名、电邮地址、电话号码、国家或地区、出生日期、性别。",
        why: "用于办理报名、确认名额，并就课程与您联系。",
      },
      {
        what: "背景资料",
        examples: "职业、行业、语言偏好、了解我们的渠道、以往参加过的课程。",
        why: "用于安排合适的课程与分组，并顺利举办活动。",
      },
      {
        what: "讯息内容",
        examples: "与我们的 WhatsApp 对话、电邮往来，以及您发送的文件或图片。",
        why: "用于回覆您的问题，并保留双方沟通记录。",
      },
      {
        what: "付款记录",
        examples: "金额、币种、付款状态，以及支付服务商提供的参考编号。",
        why: "用于确认报名并保存财务记录。我们不会看到或储存您的银行卡资料。",
      },
      {
        what: "照片与面部资料",
        examples: "个人照片，以及用于比对的面部特征数值。",
        why: "仅在您明确同意的情况下使用，用以加快现场签到。详见下文。",
      },
      {
        what: "行程资料",
        examples: "航班编号、抵离时间、酒店。",
        why: "在课程包含接送或住宿安排时，用于统筹机场接送与住宿。",
      },
      {
        what: "课程记录",
        examples: "出席情况、分组安排、您提交的作业，以及我们团队的内部记录。",
        why: "用于课程运作与学习支持。",
      },
    ] as Row[],
    faceTitle: "人脸识别 —— 自愿选择，可随时撤回",
    face: "在您同意的前提下，我们会根据您的照片生成面部特征数值，用于活动签到时辨识您的身份。此项为自愿选择：不使用亦可正常参加活动，您也可随时撤回同意 —— 我们将删除相关面部资料，改以姓名签到。该资料不作签到以外的任何用途，也不会对外分享。",
    waTitle: "关于 WhatsApp",
    wa: "当您透过 WhatsApp 与我们联系，或我们向您发送讯息时，这些讯息会经由 Meta 的 WhatsApp Business 平台传送，因此同时受 Meta 自身的隐私条款与本政策约束。我们会保存对话记录，以便团队了解来龙去脉并妥善回覆。您可随时回覆「退订」，或告知任何一位团队成员，我们即会停止发送。",
    aiTitle: "自动回覆协助",
    ai: "我们使用自动助理协助回答常见问题，并为团队草拟回覆。为此，讯息内容可能会交由我们的 AI 服务商 Anthropic 处理。在传送之前，我们会将姓名、电邮与电话替换为内部代号，因此助理不会取得您的联络方式。人工同事可随时接手对话，您亦可随时要求转接人工。",
    shareTitle: "还有谁会看到",
    share: "我们不会出售您的资料，也不会将其用于广告用途。我们使用以下服务商来运作：",
    processors: [
      "Meta Platforms —— WhatsApp 讯息传送",
      "Supabase —— 数据库与档案储存",
      "Netlify —— 网站托管",
      "HitPay 与 Stripe —— 支付处理",
      "Anthropic —— 自动回覆协助",
      "电邮服务商 —— 发送确认信与收据",
    ],
    shareAfter:
      "在法律要求时，或为顺利举办您已报名的课程所必需时，我们亦可能分享相关资料 —— 例如向酒店提供住房名单，或向机场接送供应商提供乘客名单。",
    keepTitle: "保存多久",
    keep: "在您与 GMC 保持往来期间，我们会保存学员记录；其后则保存至满足法律与会计义务所需的期限为止。面部资料会在您撤回同意时，或在签到不再需要时删除。",
    rightsTitle: "您的选择",
    rightsIntro: "您可以要求我们：",
    rights: [
      "告知我们持有您哪些资料",
      "更正其中有误之处",
      "在法律未要求保存的前提下，删除您的资料",
      "停止在任何渠道向您发送讯息",
      "撤回您对人脸识别的同意",
    ],
    rightsAfter: `请来函 ${CONTACT_EMAIL}，我们会予以回覆。若您对我们的处理方式不满意，可向您所在国家或地区的个人资料保护主管机关提出。`,
    contactTitle: "联络我们",
    contact: `Glorious Melodies Consultancy Pte Ltd，新加坡 · ${CONTACT_EMAIL}`,
  },
} as const;

// `id` exists so Meta's "Data deletion instructions URL" can point at
// /privacy#your-choices rather than a placeholder. Anchors also give support
// staff something specific to send someone who asks a narrow question.
function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 first:mt-0 scroll-mt-24">
      <h2 className="font-display text-[22px] md:text-[26px] leading-[1.25] tracking-[-0.02em] text-[var(--ink)]">
        {title}
      </h2>
      <div className="mt-4 text-[16px] leading-[1.75] text-[var(--ink-soft)] space-y-4">
        {children}
      </div>
    </section>
  );
}

export default async function PrivacyPage() {
  const locale = await getServerLocale();
  const c = COPY[locale];

  return (
    <>
      <PagePreamble eyebrow={c.eyebrow} heading={c.heading} sub={c.sub} />

      <div className="mx-auto max-w-[1280px] px-6 md:px-10 pb-24 md:pb-32">
        <div className="max-w-[760px]">
          <p className="text-[13px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
            {c.updated}
          </p>

          <Section title={c.whoTitle}>
            <p>{c.who}</p>
          </Section>

          <Section title={c.collectTitle}>
            {/* The mapping IS the answer to "what do you do with my data", so it
                gets a real structure rather than being buried in prose. */}
            <dl className="mt-2 divide-y divide-[var(--paper-shadow)] border-y border-[var(--paper-shadow)]">
              {c.rows.map((row) => (
                <div
                  key={row.what}
                  className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-8 gap-y-2 py-6"
                >
                  <dt className="font-display text-[17px] leading-[1.4] text-[var(--ink)]">
                    {row.what}
                  </dt>
                  <dd className="space-y-2">
                    <p className="text-[15px] leading-[1.7] text-[var(--ink-soft)]">
                      {row.examples}
                    </p>
                    <p className="text-[15px] leading-[1.7] text-[var(--ink-mute)]">
                      {row.why}
                    </p>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title={c.faceTitle} id="facial-recognition">
            <p>{c.face}</p>
          </Section>

          <Section title={c.waTitle} id="whatsapp">
            <p>{c.wa}</p>
          </Section>

          <Section title={c.aiTitle}>
            <p>{c.ai}</p>
          </Section>

          <Section title={c.shareTitle}>
            <p>{c.share}</p>
            <ul className="space-y-2 pl-0">
              {c.processors.map((p) => (
                <li
                  key={p}
                  className="relative pl-5 text-[15px] leading-[1.7] before:absolute before:left-0 before:top-[0.7em] before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--cinnabar-soft)]"
                >
                  {p}
                </li>
              ))}
            </ul>
            <p>{c.shareAfter}</p>
          </Section>

          <Section title={c.keepTitle}>
            <p>{c.keep}</p>
          </Section>

          <Section title={c.rightsTitle} id="your-choices">
            <p>{c.rightsIntro}</p>
            <ul className="space-y-2 pl-0">
              {c.rights.map((r) => (
                <li
                  key={r}
                  className="relative pl-5 text-[15px] leading-[1.7] before:absolute before:left-0 before:top-[0.7em] before:h-[5px] before:w-[5px] before:rounded-full before:bg-[var(--cinnabar-soft)]"
                >
                  {r}
                </li>
              ))}
            </ul>
            <p>{c.rightsAfter}</p>
          </Section>

          <Section title={c.contactTitle} id="contact">
            <p>{c.contact}</p>
          </Section>
        </div>
      </div>
    </>
  );
}
