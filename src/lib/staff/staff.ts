import "server-only";
import type { User } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { StaffMember, StaffRole } from "./roles";

// Staff links carry a one-time token that is only used when the person submits
// their new password, so an email scanner opening the link can't burn it.

export type SetupLinkType = "invite" | "recovery";

export type LinkDelivery = {
  setup_url: string | null;
  email_sent: boolean;
};

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const service = createSupabaseServiceClient();
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
}

export async function createSetupLink(
  email: string,
  type: SetupLinkType,
): Promise<{ userId: string; url: string } | { error: string }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type, email });
  const token = data?.properties?.hashed_token;
  if (error || !token || !data.user) {
    return { error: error?.message ?? "link_failed" };
  }
  const qs = new URLSearchParams({ token, type });
  return { userId: data.user.id, url: `${siteUrl()}/auth/setup?${qs.toString()}` };
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
