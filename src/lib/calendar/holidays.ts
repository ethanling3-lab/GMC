import "server-only";
import Holidays from "date-holidays";
import type { HolidayPreset, HolidayRegion } from "./types";

// Import source for the admin-managed holiday list (calendar_holidays,
// migration 076): "Import <year>" pre-fills a year from here, then the admin
// edits / deletes / adds. Calculated offline by the
// `date-holidays` package (lunar CNY, Islamic calendar, Sunday→Monday
// substitutes). No API, no cron, no DB rows. Server-only: the package is
// large, so it must never reach the client bundle.
//
// Regions (Ethan, 2026-11-25): Malaysia national, Johor state ("01"),
// Singapore. Johor shows only the days Johor adds on top of national ones.

type Canon = { id: string; en: string; cn: string; islamic?: boolean };

// Keyed by the library's rule (lower-case). One canonical id per holiday so
// the same day in MY and SG merges into one row with both tags.
const BY_RULE: Record<string, Canon> = {
  "01-01": { id: "new-year", en: "New Year's Day", cn: "元旦" },
  "chinese 01-0-01": { id: "cny", en: "Chinese New Year", cn: "农历新年" },
  "chinese 01-0-02": { id: "cny2", en: "Chinese New Year (day 2)", cn: "农历新年（初二）" },
  "chinese 04-0-15": { id: "vesak", en: "Vesak Day", cn: "卫塞节" },
  "1 ramadan": { id: "ramadan", en: "Start of Ramadan", cn: "斋月首日", islamic: true },
  "17 ramadan": { id: "nuzul", en: "Nuzul Al-Quran", cn: "可兰经降世日", islamic: true },
  "1 shawwal": { id: "raya", en: "Hari Raya Aidilfitri", cn: "开斋节", islamic: true },
  "2 shawwal": { id: "raya2", en: "Hari Raya Aidilfitri (day 2)", cn: "开斋节（第二天）", islamic: true },
  "10 dhu al-hijjah": { id: "haji", en: "Hari Raya Haji", cn: "哈芝节", islamic: true },
  "1 muharram": { id: "muharram", en: "Awal Muharram", cn: "回历新年", islamic: true },
  "12 rabi al-awwal": { id: "maulid", en: "Prophet Muhammad's Birthday", cn: "先知穆罕默德诞辰", islamic: true },
  "6 safar": { id: "hol-johor", en: "Hari Hol Sultan Iskandar", cn: "柔佛已故苏丹纪念日", islamic: true },
  "1st monday in june": { id: "agong", en: "Agong's Birthday", cn: "最高元首诞辰" },
  "03-23": { id: "sultan-johor", en: "Sultan of Johor's Birthday", cn: "柔佛苏丹诞辰" },
  "05-01": { id: "labour", en: "Labour Day", cn: "劳动节" },
  "08-31": { id: "merdeka", en: "Merdeka (National Day)", cn: "马来西亚国庆日" },
  "09-16": { id: "malaysia-day", en: "Malaysia Day", cn: "马来西亚日" },
  "08-09": { id: "sg-national", en: "Singapore National Day", cn: "新加坡国庆日" },
  "easter -2": { id: "good-friday", en: "Good Friday", cn: "耶稣受难日" },
  "12-25": { id: "christmas", en: "Christmas Day", cn: "圣诞节" },
};

// Holidays the library lists as fixed dates (rule is the date itself).
const BY_NAME: Array<[RegExp, Canon]> = [
  [/deepavali|diwali/i, { id: "deepavali", en: "Deepavali", cn: "屠妖节" }],
  [/vesak|wesak/i, { id: "vesak", en: "Vesak Day", cn: "卫塞节" }],
  [/thaipusam/i, { id: "thaipusam", en: "Thaipusam", cn: "大宝森节" }],
  [/eid al-fitr|hari raya puasa/i, { id: "raya", en: "Hari Raya Aidilfitri", cn: "开斋节", islamic: true }],
  [/eid al-adha|hari raya haji/i, { id: "haji", en: "Hari Raya Haji", cn: "哈芝节", islamic: true }],
];

type Raw = { date: string; name: string; rule: string; substitute?: boolean };

function canonFor(raw: Raw): Canon {
  let rule = raw.rule.toLowerCase().trim();
  // "substitutes chinese 01-0-02 if sunday then next monday" → base rule
  const sub = rule.match(/^substitutes (.+?) if /);
  if (sub) rule = sub[1];
  const hit = BY_RULE[rule] ?? BY_NAME.find(([re]) => re.test(raw.name))?.[1];
  if (hit) return hit;
  const name = raw.name.replace(/\s*\(substitute day\)\s*/i, "").trim();
  return { id: `x:${name.toLowerCase()}`, en: name, cn: name };
}

function load(country: string, state: string | undefined, year: number): Raw[] {
  const hd = state
    ? new Holidays(country, state, { languages: ["en"], types: ["public"] })
    : new Holidays(country, { languages: ["en"], types: ["public"] });
  let list = hd.getHolidays(year) as unknown as Raw[];
  // The library lists Vesak as fixed dates that stop at 2026; it falls on
  // the 15th of the 4th lunar month, so add it by rule when missing.
  if (!list.some((h) => /vesak|wesak/i.test(h.name))) {
    hd.setHoliday("chinese 04-0-15", { name: { en: "Vesak Day" }, type: "public" });
    list = hd.getHolidays(year) as unknown as Raw[];
  }
  return list;
}

const cache = new Map<number, HolidayPreset[]>();

export function holidayPresetsForYear(year: number): HolidayPreset[] {
  const hit = cache.get(year);
  if (hit) return hit;

  const rows = new Map<string, HolidayPreset>();
  const nationalMy = new Set<string>();

  const add = (raw: Raw, region: HolidayRegion) => {
    const date = raw.date.slice(0, 10);
    const canon = canonFor(raw);
    const observed = Boolean(raw.substitute);
    const key = `${date}|${canon.id}|${observed ? "obs" : ""}`;
    if (region === "MY") nationalMy.add(key);
    // Johor tag only for days Johor adds on top of the national list.
    if (region === "JHR" && nationalMy.has(key)) return;
    const row = rows.get(key);
    if (row) {
      if (!row.regions.includes(region)) row.regions.push(region);
      return;
    }
    rows.set(key, {
      date,
      // Substitute day: "Chinese New Year (observed)", not "(day 2) (observed)".
      name_en: observed ? `${canon.en.replace(/ \(day 2\)$/, "")} (observed)` : canon.en,
      name_cn: observed ? `${canon.cn.replace(/（[^）]*）$/, "")}（补假）` : canon.cn,
      regions: [region],
      estimated: Boolean(canon.islamic),
    });
  };

  // MY national first so the Johor pass can tell which days are extra.
  for (const r of load("MY", undefined, year)) add(r, "MY");
  for (const r of load("MY", "01", year)) add(r, "JHR");
  for (const r of load("SG", undefined, year)) add(r, "SG");

  const order: HolidayRegion[] = ["MY", "JHR", "SG"];
  const out = [...rows.values()]
    .map((h) => ({ ...h, regions: order.filter((r) => h.regions.includes(r)) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name_en.localeCompare(b.name_en));
  cache.set(year, out);
  return out;
}
