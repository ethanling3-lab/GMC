// Motivation · 报名动机 = WHY the participant is attending (migration 070).
// Stored as an ordered text[] on participants.motivations — first = main
// reason. Client-safe: no server-only imports.

export const MOTIVATIONS = [
  "networking",
  "spiritual",
  "business",
  "family",
  "other",
] as const;

export type MotivationTag = (typeof MOTIVATIONS)[number];

export const MOTIVATION_LABEL: Record<MotivationTag, { en: string; cn: string }> = {
  networking: { en: "Networking", cn: "人脉拓展" },
  spiritual: { en: "Spiritual learning", cn: "灵性学习" },
  business: { en: "Business growth", cn: "事业提升" },
  family: { en: "Family & relationships", cn: "家庭关系" },
  other: { en: "Other", cn: "其他" },
};

export function isMotivation(v: unknown): v is MotivationTag {
  return typeof v === "string" && (MOTIVATIONS as readonly string[]).includes(v);
}

/** Chinese label for one reason; "其他（…）" carries the free text. */
export function motivationCn(m: MotivationTag, otherText?: string | null): string {
  const t = otherText?.trim();
  return m === "other" && t ? `其他（${t}）` : MOTIVATION_LABEL[m].cn;
}

/** "人脉拓展 · Networking, 其他 · Other: 想认识师父" — for exports. */
export function motivationsLabel(
  list: readonly string[] | null | undefined,
  otherText?: string | null,
): string {
  const t = otherText?.trim();
  return (list ?? [])
    .filter(isMotivation)
    .map((m) =>
      m === "other" && t
        ? `${MOTIVATION_LABEL.other.cn} · ${MOTIVATION_LABEL.other.en}: ${t}`
        : `${MOTIVATION_LABEL[m].cn} · ${MOTIVATION_LABEL[m].en}`,
    )
    .join(", ");
}
