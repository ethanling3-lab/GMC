import "server-only";
import type {
  TemplateLanguage,
  TemplateParamSpec,
  TemplateSummary,
} from "./whatsapp-templates-types";

// WhatsApp template registry — used by the inbox composer to send HSM
// templates outside the 24-hour customer-service window.
//
// Every entry here MUST correspond to a template that is already approved
// in the Meta Business Manager WABA. Meta rejects sends to unapproved names
// with a 132000-range error. Template body strings below are our best-effort
// reconstruction for local preview / thread display — the actual wording is
// whatever Meta has approved. Params are positional and must match the
// variable slots ({{1}}, {{2}}, ...) in the approved body.
//
// Adding a new template:
//   1. Submit for approval in Meta Business Manager (WhatsApp Manager →
//      Message Templates). Wait for Approved status.
//   2. Append an entry below with the same `name` + languages + params.
//   3. `render` produces the preview string stored in messages.body_text.
//   4. `buildComponents` produces Meta's components[] payload.

export type TemplateDefinition = {
  name: string;
  category: TemplateSummary["category"];
  label_en: string;
  label_cn: string;
  description_en: string;
  description_cn: string;
  languages: readonly TemplateLanguage[];
  params: readonly TemplateParamSpec[];
  /** Build the rendered preview text (what we store in messages.body_text). */
  render(params: Record<string, string>, language: TemplateLanguage): string;
  /** Build Meta's components[] payload from params. */
  buildComponents(params: Record<string, string>): WhatsAppComponent[];
};

export type WhatsAppComponent = {
  type: "body" | "header" | "button";
  parameters: Array<{ type: "text"; text: string }>;
  sub_type?: "url" | "quick_reply";
  index?: string;
};

function positional(
  params: Record<string, string>,
  keys: readonly string[],
): Array<{ type: "text"; text: string }> {
  return keys.map((k) => ({ type: "text" as const, text: (params[k] ?? "").trim() }));
}

const gmcEnrollmentApproved: TemplateDefinition = {
  name: "gmc_enrollment_approved",
  category: "utility",
  label_en: "Enrollment · approved",
  label_cn: "报名 · 审批通过",
  description_en: "Confirms the enrollment was approved and shares the payment link.",
  description_cn: "告知报名已获批准并附上付款链接。",
  languages: ["en_US", "zh_CN"],
  params: [
    { key: "name", label_en: "Participant name", label_cn: "参与者姓名" },
    { key: "event_title", label_en: "Event title", label_cn: "活动名称" },
    { key: "amount", label_en: "Amount due", label_cn: "应付金额", type: "amount" },
    { key: "payment_url", label_en: "Payment link", label_cn: "付款链接", type: "url" },
  ],
  render(params, language) {
    if (language === "zh_CN") {
      return `${params.name ?? ""}，您的 GMC 报名「${params.event_title ?? ""}」已获批准。应付金额：${params.amount ?? ""}。付款链接：${params.payment_url ?? ""}`;
    }
    return `Dear ${params.name ?? ""}, your GMC registration for ${params.event_title ?? ""} is approved. Amount due: ${params.amount ?? ""}. Complete payment: ${params.payment_url ?? ""}`;
  },
  buildComponents(params) {
    return [
      {
        type: "body",
        parameters: positional(params, ["name", "event_title", "amount", "payment_url"]),
      },
    ];
  },
};

const gmcPaymentReceived: TemplateDefinition = {
  name: "gmc_payment_received",
  category: "utility",
  label_en: "Payment · received",
  label_cn: "付款 · 已收到",
  description_en: "Acknowledges a payment has been received for an enrolled event.",
  description_cn: "确认已收到某活动的付款。",
  languages: ["en_US", "zh_CN"],
  params: [
    { key: "name", label_en: "Participant name", label_cn: "参与者姓名" },
    { key: "event_title", label_en: "Event title", label_cn: "活动名称" },
    { key: "amount", label_en: "Amount", label_cn: "金额", type: "amount" },
  ],
  render(params, language) {
    if (language === "zh_CN") {
      return `${params.name ?? ""}，已收到您的付款「${params.event_title ?? ""}」。金额：${params.amount ?? ""}。`;
    }
    return `${params.name ?? ""}, we've received your payment for ${params.event_title ?? ""}. Amount: ${params.amount ?? ""}.`;
  },
  buildComponents(params) {
    return [
      {
        type: "body",
        parameters: positional(params, ["name", "event_title", "amount"]),
      },
    ];
  },
};

function buildRejection(
  reason: "no_seats" | "duplicate" | "unsuitable" | "other",
): TemplateDefinition {
  const labels: Record<typeof reason, { en: string; cn: string; desc_en: string; desc_cn: string }> = {
    no_seats: {
      en: "Rejection · no seats",
      cn: "拒绝 · 名额已满",
      desc_en: "Polite rejection when the event is full.",
      desc_cn: "活动名额已满时的礼貌拒绝。",
    },
    duplicate: {
      en: "Rejection · duplicate",
      cn: "拒绝 · 重复报名",
      desc_en: "Closes a duplicate registration.",
      desc_cn: "关闭重复报名。",
    },
    unsuitable: {
      en: "Rejection · criteria",
      cn: "拒绝 · 未符条件",
      desc_en: "Rejection when the participant does not meet event criteria.",
      desc_cn: "参与者不符合活动参与条件时使用。",
    },
    other: {
      en: "Rejection · other",
      cn: "拒绝 · 其他",
      desc_en: "Generic rejection for any other reason.",
      desc_cn: "其他原因的通用拒绝。",
    },
  };
  const pack = labels[reason];
  return {
    name: `gmc_enrollment_rejected_${reason}`,
    category: "utility",
    label_en: pack.en,
    label_cn: pack.cn,
    description_en: pack.desc_en,
    description_cn: pack.desc_cn,
    languages: ["en_US", "zh_CN"],
    params: [
      { key: "name", label_en: "Participant name", label_cn: "参与者姓名" },
      { key: "event_title", label_en: "Event title", label_cn: "活动名称" },
    ],
    render(params, language) {
      if (language === "zh_CN") {
        return `${params.name ?? ""}，关于您的 GMC 报名「${params.event_title ?? ""}」— 很遗憾无法确认本次席位。`;
      }
      return `Dear ${params.name ?? ""}, regarding your GMC registration for ${params.event_title ?? ""} — we're unable to confirm a seat this time.`;
    },
    buildComponents(params) {
      return [
        {
          type: "body",
          parameters: positional(params, ["name", "event_title"]),
        },
      ];
    },
  };
}

const REGISTRY: readonly TemplateDefinition[] = [
  gmcEnrollmentApproved,
  gmcPaymentReceived,
  buildRejection("no_seats"),
  buildRejection("duplicate"),
  buildRejection("unsuitable"),
  buildRejection("other"),
];

export function listTemplates(): readonly TemplateDefinition[] {
  return REGISTRY;
}

export function findTemplate(name: string): TemplateDefinition | undefined {
  return REGISTRY.find((t) => t.name === name);
}

export function toSummary(def: TemplateDefinition): TemplateSummary {
  return {
    name: def.name,
    category: def.category,
    label_en: def.label_en,
    label_cn: def.label_cn,
    description_en: def.description_en,
    description_cn: def.description_cn,
    languages: def.languages,
    params: def.params,
  };
}
