// The six details everyone must have before registering for any event or
// course (Phase 5, Ethan 2026-11-26): name, phone, referrer, referrer
// contact, occupation, industry. Client-safe — the confirm page, its API and
// the profile API all use this one list.

export type RequiredProfile = {
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  occupation: string | null;
  industry: string | null;
  referrer_name: string | null;
  referrer_contact: string | null;
};

export type RequiredField = "name" | "phone" | "occupation" | "industry" | "referrer_name" | "referrer_contact";

export const REQUIRED_FIELD_LABEL: Record<RequiredField, { en: string; zh: string }> = {
  name: { en: "Name", zh: "姓名" },
  phone: { en: "Phone", zh: "电话" },
  occupation: { en: "Occupation", zh: "职业" },
  industry: { en: "Industry", zh: "行业" },
  referrer_name: { en: "Referred by", zh: "介绍人" },
  referrer_contact: { en: "Referrer's contact", zh: "介绍人联系方式" },
};

const blank = (v: string | null | undefined) => !v || !v.trim();

export function missingProfileFields(p: RequiredProfile): RequiredField[] {
  const out: RequiredField[] = [];
  if (blank(p.name_cn) && blank(p.name_en)) out.push("name");
  if (blank(p.phone)) out.push("phone");
  if (blank(p.occupation)) out.push("occupation");
  if (blank(p.industry)) out.push("industry");
  if (blank(p.referrer_name)) out.push("referrer_name");
  if (blank(p.referrer_contact)) out.push("referrer_contact");
  return out;
}

export const REQUIRED_PROFILE_COLUMNS = "name_cn, name_en, phone, occupation, industry, referrer_name, referrer_contact";
