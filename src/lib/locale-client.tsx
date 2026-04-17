"use client";

import { createContext, useContext } from "react";
import type { Locale } from "@/lib/types";
import { getDict, t as translate, type Dict } from "@/lib/i18n";

type LocaleCtx = {
  locale: Locale;
  dict: Dict;
  t: (path: string, fallback?: string) => string;
};

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const dict = getDict(locale);
  const value: LocaleCtx = {
    locale,
    dict,
    t: (path, fallback) => translate(dict, path, fallback),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLocale must be used within <LocaleProvider>");
  return v;
}
