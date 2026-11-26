// Customer regions (Phase 3, migration 088). Client-safe.
// Malaysians: an admin picks the region. Everyone else: from their country.

export const SEGMENTS = [
  { value: "my_north", cn: "北马", en: "North Malaysia" },
  { value: "my_central", cn: "中马", en: "Central Malaysia" },
  { value: "my_south", cn: "南马", en: "South Malaysia" },
  { value: "my_east", cn: "东马", en: "East Malaysia" },
  { value: "sg", cn: "新加坡", en: "Singapore" },
  { value: "tw", cn: "台湾", en: "Taiwan" },
  { value: "vn", cn: "越南", en: "Vietnam" },
  { value: "hk", cn: "香港", en: "Hong Kong" },
  { value: "cn", cn: "中国", en: "China" },
  { value: "other", cn: "其他", en: "Other" },
] as const;

export type Segment = (typeof SEGMENTS)[number]["value"];
export const SEGMENT_VALUES = SEGMENTS.map((s) => s.value) as [Segment, ...Segment[]];

export function segmentLabel(s: string | null | undefined): string | null {
  const hit = SEGMENTS.find((x) => x.value === s);
  return hit ? hit.cn : null;
}

export const MY_SEGMENTS: readonly Segment[] = ["my_north", "my_central", "my_south", "my_east"];

/**
 * The region from the country. Malaysians return null: an admin picks
 * 北马 / 中马 / 南马 / 东马 (Ethan, 2026-11-26).
 */
export function segmentFor(region: string | null | undefined): Segment | null {
  const r = (region ?? "").trim().toUpperCase();
  switch (r) {
    case "MY":
      return null;
    case "SG":
      return "sg";
    case "TW":
      return "tw";
    case "VN":
      return "vn";
    case "HK":
      return "hk";
    case "CN":
      return "cn";
    case "":
      return null;
    default:
      return "other";
  }
}
