import "server-only";
import type { TemplateParamSpec } from "./whatsapp-templates-types";

// Param label overrides for known WhatsApp templates. Meta returns positional
// `{{1}}`, `{{2}}` slots with no names — this map lets the composer show
// "Participant name" instead of "Variable 1" for templates we already know.
//
// Keyed by template name. Values are per-slot (index-0 = {{1}}, etc.).
//
// Adding a new override:
//   - Submit + approve the template in Meta Business Manager first.
//   - Once the sync pulls it in, add an entry here so the picker reads well.
//   - Unknown templates fall back to generic "Variable N / 变量 N" labels.

type SlotOverride = Omit<TemplateParamSpec, "key">;

const OVERRIDES: Record<string, readonly SlotOverride[]> = {
  gmc_enrollment_approved: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
    { label_en: "Amount due", label_cn: "应付金额", type: "amount" },
    { label_en: "Payment link", label_cn: "付款链接", type: "url" },
  ],
  gmc_payment_received: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
    { label_en: "Amount", label_cn: "金额", type: "amount" },
  ],
  gmc_enrollment_rejected_no_seats: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
  ],
  gmc_enrollment_rejected_duplicate: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
  ],
  gmc_enrollment_rejected_unsuitable: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
  ],
  gmc_enrollment_rejected_other: [
    { label_en: "Participant name", label_cn: "参与者姓名" },
    { label_en: "Event title", label_cn: "活动名称" },
  ],
};

/**
 * Build TemplateParamSpec[] from a template name and positional slot count.
 * Uses override labels when present; otherwise falls back to generic
 * Variable N / 变量 N so admins still get a usable form.
 */
export function buildParamSpecs(
  templateName: string,
  slotCount: number,
): TemplateParamSpec[] {
  const overrides = OVERRIDES[templateName];
  const specs: TemplateParamSpec[] = [];
  for (let i = 0; i < slotCount; i++) {
    const key = `variable_${i + 1}`;
    const o = overrides?.[i];
    if (o) {
      specs.push({ key, ...o });
    } else {
      specs.push({
        key,
        label_en: `Variable ${i + 1}`,
        label_cn: `变量 ${i + 1}`,
      });
    }
  }
  return specs;
}
