// Client-safe staff role and region lists.

export const STAFF_ROLES = [
  {
    value: "super_admin",
    label: "Super admin",
    labelZh: "超级管理员",
    description: "Full access, including events, finance and staff.",
  },
  {
    value: "regional_lead",
    label: "Regional lead",
    labelZh: "区域负责人",
    description: "Manages participants in their region and runs Logistics.",
  },
  {
    value: "customer_service",
    label: "Customer service",
    labelZh: "客服",
    description: "Handles the inbox, their assigned participants and the flight worklist.",
  },
  {
    value: "finance",
    label: "Finance",
    labelZh: "财务",
    description: "Handles payments and finance records.",
  },
  {
    value: "instructor",
    label: "Instructor",
    labelZh: "讲师",
    description: "Views participants and event information.",
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
