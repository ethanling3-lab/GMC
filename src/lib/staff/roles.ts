// Client-safe staff role and region lists.

export const STAFF_ROLES = [
  {
    value: "super_admin",
    label: "Super admin",
    labelZh: "超级管理员",
    description: "Full access, including events, finance and staff.",
  },
  {
    value: "customer_service",
    label: "Customer service",
    labelZh: "客服",
    description: "Handles their assigned participants, including those customers' flights.",
  },
  {
    value: "finance",
    label: "Finance",
    labelZh: "财务",
    description: "Handles payments and finance records.",
  },
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number]["value"];

export const STAFF_ROLE_VALUES = STAFF_ROLES.map((r) => r.value) as [StaffRole, ...StaffRole[]];

export const STAFF_REGIONS = ["SG", "MY", "HK", "TW", "CN"] as const;

export type StaffRegion = (typeof STAFF_REGIONS)[number];

export type StaffMember = {
  id: string;
  name_en: string | null;
  name_cn: string | null;
  email: string;
  role: StaffRole;
  region: string | null;
  status: "active" | "invited" | "removed";
  last_sign_in_at: string | null;
};
