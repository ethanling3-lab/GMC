import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase";

// One-time account links. The token is only spent when someone submits a new
// password, so an email scanner opening the link can't use it up.

export type AccountLinkType = "invite" | "recovery";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

export async function createAccountLink(
  email: string,
  type: AccountLinkType,
  path: "/auth/setup" | "/auth/account",
  /** Where to land after the password is set (checked again on use). */
  next?: string,
): Promise<{ userId: string; url: string } | { error: string }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type, email });
  const token = data?.properties?.hashed_token;
  if (error || !token || !data.user) {
    return { error: error?.message ?? "link_failed" };
  }
  const qs = new URLSearchParams({ token, type });
  if (next) qs.set("next", next);
  return { userId: data.user.id, url: `${siteUrl()}${path}?${qs.toString()}` };
}
