import "server-only";
import {
  createAccountLink,
  escapeHtml,
  findAuthUserByEmail,
  siteUrl,
  type AccountLinkType,
} from "@/lib/auth-links";
import { sendEmail } from "@/lib/email";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { StaffMember, StaffRole } from "./roles";

// Staff links carry a one-time token that is only used when the person submits
// their new password, so an email scanner opening the link can't burn it.

export type SetupLinkType = AccountLinkType;

export { findAuthUserByEmail };

export async function loadStaff(): Promise<StaffMember[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("admins")
    .select("id, name_en, name_cn, role, region, deactivated_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const members = await Promise.all(
    (data ?? []).map(async (a): Promise<StaffMember> => {
      const { data: auth } = await service.auth.admin.getUserById(a.id);
      const user = auth?.user;
      return {
        id: a.id,
        name_en: a.name_en,
        name_cn: a.name_cn,
        email: user?.email ?? "",
        role: a.role as StaffRole,
        region: a.region,
        status: a.deactivated_at
          ? "removed"
          : user?.last_sign_in_at
            ? "active"
            : "invited",
        last_sign_in_at: user?.last_sign_in_at ?? null,
      };
    }),
  );
  const rank = { active: 0, invited: 1, removed: 2 };
  return members.sort((a, b) => rank[a.status] - rank[b.status]);
}

export function createSetupLink(email: string, type: SetupLinkType) {
  return createAccountLink(email, type, "/auth/setup");
}

export async function sendSetupEmail(args: {
  to: string;
  name: string;
  url: string;
  type: SetupLinkType;
}): Promise<boolean> {
  const name = escapeHtml(args.name);
  const url = escapeHtml(args.url);
  const isInvite = args.type === "invite";
  const result = await sendEmail({
    to: args.to,
    subject: isInvite
      ? "Set up your GMC staff account · 设置您的 GMC 员工账户"
      : "Set your GMC staff password · 设置您的 GMC 员工密码",
    html: `<p>Hi ${name},</p>
<p>${isInvite ? "You've been added to the GMC staff system." : "Use this link to set your GMC staff password."} Open the link below and choose a password.</p>
<p><a href="${url}">Set my password</a></p>
<p>This link works once and expires. If it has expired, ask your admin for a new one.</p>
<hr />
<p>${name}，您好：</p>
<p>${isInvite ? "您已被添加到 GMC 员工系统。" : "请使用此链接设置您的 GMC 员工密码。"}请打开以下链接并设置密码。</p>
<p><a href="${url}">设置我的密码</a></p>
<p>此链接仅可使用一次，并会过期。如已过期，请向管理员索取新链接。</p>`,
    textFooter: `Set your password · 设置密码: ${args.url}`,
  });
  return !result.mocked && !result.error;
}

export async function sendAccessEmail(args: { to: string; name: string }): Promise<boolean> {
  const name = escapeHtml(args.name);
  const url = escapeHtml(`${siteUrl()}/admin/login`);
  const result = await sendEmail({
    to: args.to,
    subject: "You now have GMC staff access · 您已获得 GMC 员工权限",
    html: `<p>Hi ${name},</p>
<p>You now have staff access. Sign in with your existing password:</p>
<p><a href="${url}">Open the staff sign-in</a></p>
<hr />
<p>${name}，您好：</p>
<p>您已获得员工权限，请使用现有密码登录：</p>
<p><a href="${url}">打开员工登录页面</a></p>`,
    textFooter: `Staff sign-in · 员工登录: ${siteUrl()}/admin/login`,
  });
  return !result.mocked && !result.error;
}
