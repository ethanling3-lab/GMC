// Client-safe shapes for the year calendar (Phase 1).

import type { EventStatus, EventType } from "@/lib/events-shared";

export type CalendarSession = {
  id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  status: EventStatus;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;
  dates_tentative: boolean;
  city: string | null;
  country: string | null;
  type: EventType;
};

// Holiday regions: a country ("MY", "SG", "TW") or a Malaysian state
// ("JHR" = Johor, holidays it adds on top of the national list). Stored as
// codes; to offer a new region, add it to HOLIDAY_REGION_CATALOGUE — no
// migration needed (077 only checks the code shape).
export type HolidayRegion = string;

export type HolidayRegionInfo = { code: string; en: string; cn: string; group: "country" | "my_state" };

// Order = display order everywhere (dropdown, tags, calendar toggles).
export const HOLIDAY_REGION_CATALOGUE: HolidayRegionInfo[] = [
  { code: "MY", en: "Malaysia", cn: "马来西亚", group: "country" },
  { code: "SG", en: "Singapore", cn: "新加坡", group: "country" },
  { code: "TW", en: "Taiwan", cn: "台湾", group: "country" },
  { code: "HK", en: "Hong Kong", cn: "香港", group: "country" },
  { code: "CN", en: "China", cn: "中国", group: "country" },
  { code: "VN", en: "Vietnam", cn: "越南", group: "country" },
  { code: "TH", en: "Thailand", cn: "泰国", group: "country" },
  { code: "ID", en: "Indonesia", cn: "印尼", group: "country" },
  { code: "JHR", en: "Johor", cn: "柔佛", group: "my_state" },
  { code: "KUL", en: "Kuala Lumpur", cn: "吉隆坡", group: "my_state" },
  { code: "SGR", en: "Selangor", cn: "雪兰莪", group: "my_state" },
  { code: "PNG", en: "Penang", cn: "槟城", group: "my_state" },
  { code: "PRK", en: "Perak", cn: "霹雳", group: "my_state" },
  { code: "KDH", en: "Kedah", cn: "吉打", group: "my_state" },
  { code: "PLS", en: "Perlis", cn: "玻璃市", group: "my_state" },
  { code: "KTN", en: "Kelantan", cn: "吉兰丹", group: "my_state" },
  { code: "TRG", en: "Terengganu", cn: "登嘉楼", group: "my_state" },
  { code: "PHG", en: "Pahang", cn: "彭亨", group: "my_state" },
  { code: "NSN", en: "Negeri Sembilan", cn: "森美兰", group: "my_state" },
  { code: "MLK", en: "Melaka", cn: "马六甲", group: "my_state" },
  { code: "SBH", en: "Sabah", cn: "沙巴", group: "my_state" },
  { code: "SWK", en: "Sarawak", cn: "砂拉越", group: "my_state" },
  { code: "LBN", en: "Labuan", cn: "纳闽", group: "my_state" },
  { code: "PJY", en: "Putrajaya", cn: "布城", group: "my_state" },
];

export const HOLIDAY_REGIONS: HolidayRegion[] = HOLIDAY_REGION_CATALOGUE.map((r) => r.code);

export function isHolidayRegion(code: string): boolean {
  return HOLIDAY_REGIONS.includes(code);
}

/** Labels for any code; unknown codes fall back to the code itself. */
export function holidayRegionInfo(code: string): HolidayRegionInfo {
  return HOLIDAY_REGION_CATALOGUE.find((r) => r.code === code) ?? { code, en: code, cn: code, group: "country" };
}

/** Short tag: country code ("MY") or state name ("Johor"). */
export function holidayRegionTag(code: string): string {
  const r = holidayRegionInfo(code);
  return r.group === "my_state" ? r.en : r.code;
}

/** Sort codes into catalogue order (unknown codes last). */
export function sortHolidayRegions(codes: readonly string[]): string[] {
  const rank = (c: string) => {
    const i = HOLIDAY_REGIONS.indexOf(c);
    return i === -1 ? 999 : i;
  };
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// A row in calendar_holidays (migration 076), managed by Super Admin.
export type CalendarHoliday = {
  id: string;
  date: string; // YYYY-MM-DD
  name_en: string;
  name_cn: string | null;
  regions: HolidayRegion[];
  estimated: boolean; // Islamic calendar — official date may move ±1 day
  source: "import" | "manual";
};


// Calendar colour per event type (#RRGGBB — the year view appends alpha).
export const TYPE_COLOUR: Record<EventType, string> = {
  course: "#3B5BDB",
  retreat: "#0C8599",
  single_class: "#7048E8",
  delivery_class: "#E67700",
  other: "#868E96",
};
