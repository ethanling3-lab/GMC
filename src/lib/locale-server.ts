import "server-only";
import { cookies } from "next/headers";
import type { Locale } from "@/lib/types";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/locale-cookie";

// Read the active locale from the cookie, falling back to DEFAULT_LOCALE.
export async function getServerLocale(): Promise<Locale> {
  const c = await cookies();
  const v = c.get(LOCALE_COOKIE)?.value;
  return v === "en" || v === "zh" ? v : DEFAULT_LOCALE;
}
