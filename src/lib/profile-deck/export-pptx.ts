"use client";

// M6.8 — profile-deck (.pptx) renderer.
//
// Cover slide + one slide per participant. Each participant slide laid
// out as a briefing card: region pill · programme tier · photo · bilingual
// name · meta block · course history · enrollment status.
//
// Photo URLs come from the participant-photos bucket (public-URL form on
// the participant row). We fetch each image client-side and embed as a
// data URL so the .pptx is self-contained.

import type PptxGenJSType from "pptxgenjs";
import type {
  ProfileDeckEventMeta,
  ProfileDeckPayload,
  ProfileDeckRow,
  AttendedCourse,
} from "./types";
import type {
  GroupClassKey,
  ProgrammeTier,
  SeatRole,
} from "@/components/admin/layout/types";

export type ProfileDeckExportOptions = {
  // Include the cover slide. Default true.
  includeCover?: boolean;
  // Embed photos. Default true. Falsy → renders the initials block instead.
  includePhotos?: boolean;
  // "full"     — one widescreen slide per participant (default; presentation flow)
  // "compact"  — 3 participants per A4 portrait page (briefing print mode,
  //              ~3× paper savings vs. full)
  layout?: "full" | "compact";
};

// Editorial palette (paper + cinnabar). Hex strings, no leading "#".
const COLOR = {
  paper: "FBFCFF",
  paperDeep: "E8EEFB",
  paperShadow: "CEDAF0",
  ink: "0B2954",
  inkSoft: "1E3A6B",
  inkMute: "5774A3",
  inkFaint: "9DACC9",
  cinnabar: "2563EB",
  cinnabarDeep: "1848B8",
  cinnabarSoft: "7DA4F4",
  cinnabarWash: "EEF3FE",
  gold: "BFD2FA",
  goldSoft: "DCE6FB",
};

const FONT_TITLE = "PingFang SC";
const FONT_BODY = "Helvetica Neue";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const M = 0.5;

// Compact mode uses an A4-portrait custom layout so each printed page
// fits 3 horizontal participant cards stacked vertically.
const A4_PORTRAIT_LAYOUT = {
  name: "A4_PORTRAIT",
  width: 8.27,
  height: 11.69,
};
const A4_W = A4_PORTRAIT_LAYOUT.width;
const A4_H = A4_PORTRAIT_LAYOUT.height;
const A4_M = 0.3;
const COMPACT_HEADER_H = 0.6;
const COMPACT_GAP = 0.18;
const COMPACT_CARDS_PER_SLIDE = 3;
const COMPACT_CARD_H =
  (A4_H - A4_M * 2 - COMPACT_HEADER_H - COMPACT_GAP * (COMPACT_CARDS_PER_SLIDE - 1)) /
  COMPACT_CARDS_PER_SLIDE;
const COMPACT_CARD_W = A4_W - A4_M * 2;

const REGION_NAME: Record<string, { en: string; cn: string }> = {
  MY: { en: "Malaysia", cn: "马来西亚" },
  SG: { en: "Singapore", cn: "新加坡" },
  TW: { en: "Taiwan", cn: "台湾" },
  HK: { en: "Hong Kong", cn: "香港" },
  CN: { en: "Mainland China", cn: "中国大陆" },
};

const PROGRAMME_LABEL: Record<ProgrammeTier, { en: string; cn: string }> = {
  abundance: { en: "Abundance", cn: "丰盛" },
  glorious_family: { en: "Glorious Family", cn: "荣贵" },
  elite_cultural_heritage: { en: "Elite Cultural", cn: "精英文化财" },
  glorious_cultural_heritage: { en: "Glorious Cultural", cn: "荣耀文化财" },
};

const CLASS_LABEL: Record<GroupClassKey, { en: string; cn: string }> = {
  strategic: { en: "Strategic", cn: "特级组" },
  key: { en: "Key", cn: "重点组" },
  growth: { en: "Growth", cn: "成长组" },
  maintenance: { en: "Maintenance", cn: "维护组" },
};

const ROLE_LABEL: Record<SeatRole, { en: string; cn: string }> = {
  zu_zhang: { en: "Group Leader", cn: "组长" },
  fu_zu_zhang: { en: "Deputy Leader", cn: "副组长" },
  pai_zhang: { en: "Row Leader", cn: "排长" },
  participant: { en: "Member", cn: "成员" },
};

// Photo asset paired with its native aspect ratio (width / height). The
// card builders use the aspect to size the photo cell — so each card's
// photo cell matches the uploaded photo's shape exactly, no cropping
// and no padding around the image.
type PhotoAsset = {
  dataUrl: string;
  aspect: number;
};

const STATUS_LABEL: Record<string, { en: string; cn: string }> = {
  approved: { en: "Approved", cn: "已批准" },
  paid: { en: "Paid", cn: "已付款" },
  pending_approval: { en: "Pending", cn: "待审核" },
  rejected: { en: "Rejected", cn: "已拒绝" },
  cancelled: { en: "Cancelled", cn: "已取消" },
};

export async function exportProfileDeckPptx(
  payload: ProfileDeckPayload,
  opts: ProfileDeckExportOptions = {},
): Promise<Blob> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pres: InstanceType<typeof PptxGenJSType> = new PptxGenJS();
  const layout = opts.layout ?? "full";
  if (layout === "compact") {
    pres.defineLayout(A4_PORTRAIT_LAYOUT);
    pres.layout = A4_PORTRAIT_LAYOUT.name;
  } else {
    pres.layout = "LAYOUT_WIDE";
  }

  const includePhotos = opts.includePhotos !== false;

  // Pre-fetch + embed photos in parallel. Each entry carries the data URL
  // PLUS the photo's native aspect ratio (width / height) so the card
  // builders can size the photo cell to match the photo — no cropping, no
  // padding around the image.
  const photoByPid = new Map<string, PhotoAsset>();
  if (includePhotos) {
    const targets = payload.rows.filter((r) => r.front_photo_url);
    const results = await Promise.allSettled(
      targets.map(async (r) => {
        const dataUrl = await urlToDataUrl(r.front_photo_url!);
        const aspect = await imageAspect(dataUrl);
        return { pid: r.participant_id, dataUrl, aspect };
      }),
    );
    for (const res of results) {
      if (res.status === "fulfilled") {
        photoByPid.set(res.value.pid, {
          dataUrl: res.value.dataUrl,
          aspect: res.value.aspect,
        });
      }
    }
  }

  if (layout === "compact") {
    // 3 cards per slide. Cover slide intentionally omitted in compact —
    // the goal is paper-efficient briefing, not a presentation deck.
    for (let i = 0; i < payload.rows.length; i += COMPACT_CARDS_PER_SLIDE) {
      const batch = payload.rows.slice(i, i + COMPACT_CARDS_PER_SLIDE);
      const slideIndex = Math.floor(i / COMPACT_CARDS_PER_SLIDE) + 1;
      buildCompactSlide(pres, payload.event, batch, slideIndex, photoByPid);
    }
  } else {
    if (opts.includeCover !== false) {
      buildCoverSlide(pres, payload);
    }
    payload.rows.forEach((row, i) => {
      buildParticipantSlide(
        pres,
        payload.event,
        row,
        i + 1,
        photoByPid.get(row.participant_id) ?? null,
      );
    });
  }

  const out = await pres.write({ outputType: "blob" });
  return out as Blob;
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

function buildCoverSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  payload: ProfileDeckPayload,
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // Bottom band — gives the cover a printed-page baseline.
  slide.addShape("rect", {
    x: 0,
    y: SLIDE_H - 0.5,
    w: SLIDE_W,
    h: 0.5,
    fill: { color: COLOR.paperDeep },
    line: { color: COLOR.paperDeep },
  });

  // Eyebrow
  slide.addText("学员名册 · STUDENT PROFILE DECK", {
    x: M,
    y: M + 0.1,
    w: SLIDE_W - M * 2,
    h: 0.4,
    fontFace: FONT_BODY,
    fontSize: 12,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 4,
  });

  // Title — CN above, EN below.
  const titleCn = payload.event.title_cn ?? "";
  const titleEn = payload.event.title_en ?? payload.event.slug;
  if (titleCn) {
    slide.addText(titleCn, {
      x: M,
      y: 1.3,
      w: SLIDE_W - M * 2,
      h: 1.4,
      fontFace: FONT_TITLE,
      fontSize: 54,
      color: COLOR.ink,
      bold: true,
    });
  }
  slide.addText(titleEn, {
    x: M,
    y: titleCn ? 2.7 : 1.5,
    w: SLIDE_W - M * 2,
    h: 1.0,
    fontFace: FONT_TITLE,
    fontSize: 28,
    color: COLOR.inkSoft,
    italic: true,
  });

  // Meta block
  const counts = payload.rows.length;
  const grouped = payload.rows.filter((r) => r.group_no !== null).length;
  const meta: Array<[string, string]> = [
    ["Event · 活动", payload.event.slug],
    [
      "Dates · 日期",
      payload.event.start_date
        ? `${payload.event.start_date}${
            payload.event.end_date && payload.event.end_date !== payload.event.start_date
              ? ` → ${payload.event.end_date}`
              : ""
          }`
        : "—",
    ],
    [
      "Venue · 地点",
      [payload.event.venue, payload.event.city].filter(Boolean).join(" · ") || "—",
    ],
    ["Participants · 学员", `${counts} (${grouped} grouped)`],
    ["Generated · 生成时间", new Date().toLocaleString()],
  ];

  let cy = 4.5;
  for (const [k, v] of meta) {
    slide.addText(k, {
      x: M,
      y: cy,
      w: 5,
      h: 0.25,
      fontFace: FONT_BODY,
      fontSize: 9,
      color: COLOR.inkFaint,
      charSpacing: 2,
      bold: true,
    });
    slide.addText(v, {
      x: M + 2.5,
      y: cy,
      w: 7,
      h: 0.3,
      fontFace: FONT_BODY,
      fontSize: 13,
      color: COLOR.ink,
    });
    cy += 0.45;
  }

  slide.addText("GMC", {
    x: SLIDE_W - 2,
    y: SLIDE_H - 0.4,
    w: 1.5,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: COLOR.inkFaint,
    align: "right",
    charSpacing: 3,
  });
}

// ---------------------------------------------------------------------------
// Per-participant slide
// ---------------------------------------------------------------------------

function buildParticipantSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  event: ProfileDeckEventMeta,
  row: ProfileDeckRow,
  slideIndex: number,
  photo: PhotoAsset | null,
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // ---- Top chrome — eyebrow + group/role context ------------------------
  const groupLine = row.group_no !== null
    ? `Group ${row.group_no}${row.group_name_cn ? ` · ${row.group_name_cn}` : ""}${row.group_class ? ` · ${CLASS_LABEL[row.group_class].cn}` : ""}`
    : "Ungrouped · 未分组";

  slide.addText("学员名册 · STUDENT PROFILE", {
    x: M,
    y: 0.35,
    w: 5,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 10,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 3,
  });

  slide.addText(groupLine, {
    x: SLIDE_W - 7 - M,
    y: 0.35,
    w: 7,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 10,
    color: COLOR.inkMute,
    align: "right",
    charSpacing: 1,
  });

  // ---- Region pill + region_id (top-left, just below eyebrow) ----------
  const regionMeta = row.region ? REGION_NAME[row.region] : null;
  const regionText = regionMeta
    ? `${row.region} · ${regionMeta.cn}`
    : row.region ?? "—";

  slide.addShape("roundRect", {
    x: M,
    y: 0.8,
    w: 1.9,
    h: 0.4,
    fill: { color: COLOR.cinnabarWash },
    line: { color: COLOR.cinnabarSoft, width: 0.5 },
    rectRadius: 0.2,
  });
  slide.addText(regionText, {
    x: M,
    y: 0.83,
    w: 1.9,
    h: 0.35,
    fontFace: FONT_BODY,
    fontSize: 10,
    color: COLOR.cinnabarDeep,
    bold: true,
    align: "center",
    valign: "middle",
    charSpacing: 1,
  });

  if (row.region_id) {
    slide.addText(row.region_id, {
      x: M + 2.0,
      y: 0.8,
      w: 2.0,
      h: 0.4,
      fontFace: FONT_BODY,
      fontSize: 14,
      color: COLOR.ink,
      bold: true,
      valign: "middle",
      charSpacing: 1,
    });
  }

  // ---- Programme tier badge (top-right) --------------------------------
  if (row.programme_tier) {
    const p = PROGRAMME_LABEL[row.programme_tier];
    slide.addShape("roundRect", {
      x: SLIDE_W - 2.5 - M,
      y: 0.8,
      w: 2.5,
      h: 0.4,
      fill: { color: COLOR.paperDeep },
      line: { color: COLOR.paperShadow, width: 0.5 },
      rectRadius: 0.2,
    });
    slide.addText(`${p.cn} · ${p.en}`, {
      x: SLIDE_W - 2.5 - M,
      y: 0.83,
      w: 2.5,
      h: 0.35,
      fontFace: FONT_TITLE,
      fontSize: 11,
      color: COLOR.ink,
      bold: true,
      align: "center",
      valign: "middle",
    });
  }

  // ---- Photo (left) ----------------------------------------------------
  // Cell width is fixed at 3.5"; cell HEIGHT derives from the photo's
  // native aspect so the photo fills its cell edge-to-edge — no crop,
  // no padding. Cap height at 4.4" so unusually tall photos don't
  // overflow into the meta block below.
  const PHOTO_X = M;
  const PHOTO_Y = 1.5;
  const PHOTO_W = 3.5;
  const PHOTO_MAX_H = 4.4;
  const PHOTO_H = photo
    ? Math.min(PHOTO_MAX_H, PHOTO_W / photo.aspect)
    : PHOTO_MAX_H;

  if (photo) {
    slide.addImage({
      data: photo.dataUrl,
      x: PHOTO_X,
      y: PHOTO_Y,
      w: PHOTO_W,
      h: PHOTO_H,
      sizing: { type: "contain", w: PHOTO_W, h: PHOTO_H },
      rounding: false,
    });
  } else {
    // Initials placeholder uses the max height (no aspect to defer to).
    slide.addShape("roundRect", {
      x: PHOTO_X,
      y: PHOTO_Y,
      w: PHOTO_W,
      h: PHOTO_MAX_H,
      fill: { color: COLOR.paperDeep },
      line: { color: COLOR.paperShadow, width: 0.5 },
      rectRadius: 0.1,
    });
    slide.addText(deriveInitials(row), {
      x: PHOTO_X,
      y: PHOTO_Y,
      w: PHOTO_W,
      h: PHOTO_MAX_H,
      fontFace: FONT_TITLE,
      fontSize: 96,
      color: COLOR.cinnabarSoft,
      align: "center",
      valign: "middle",
      bold: true,
    });
  }

  // ---- Identity (right of photo) ---------------------------------------
  const ID_X = PHOTO_X + PHOTO_W + 0.5;
  const ID_W = SLIDE_W - ID_X - M;

  // Role pill above the name (only shown when role is set)
  if (row.role) {
    const rl = ROLE_LABEL[row.role];
    slide.addText(`${rl.cn} · ${rl.en.toUpperCase()}`, {
      x: ID_X,
      y: 1.5,
      w: ID_W,
      h: 0.3,
      fontFace: FONT_BODY,
      fontSize: 10,
      bold: true,
      color: row.role === "zu_zhang" ? COLOR.cinnabar : COLOR.cinnabarDeep,
      charSpacing: 3,
    });
  }

  // Big bilingual name
  const nameCn = row.name_cn ?? "";
  const nameEn = row.name_en ?? row.region_id ?? "—";

  if (nameCn) {
    slide.addText(nameCn, {
      x: ID_X,
      y: 1.85,
      w: ID_W,
      h: 1.1,
      fontFace: FONT_TITLE,
      fontSize: 48,
      color: COLOR.ink,
      bold: true,
    });
    slide.addText(nameEn, {
      x: ID_X,
      y: 2.95,
      w: ID_W,
      h: 0.5,
      fontFace: FONT_TITLE,
      fontSize: 22,
      color: COLOR.inkSoft,
      italic: true,
    });
  } else {
    slide.addText(nameEn, {
      x: ID_X,
      y: 1.95,
      w: ID_W,
      h: 1.1,
      fontFace: FONT_TITLE,
      fontSize: 44,
      color: COLOR.ink,
      bold: true,
    });
  }

  // Dharma name line
  if (row.dharma_name) {
    slide.addText(`法名 · ${row.dharma_name}`, {
      x: ID_X,
      y: 3.55,
      w: ID_W,
      h: 0.3,
      fontFace: FONT_TITLE,
      fontSize: 14,
      color: COLOR.cinnabarDeep,
      italic: true,
    });
  }

  // Old-student chip (under the name)
  if (row.is_old_student) {
    slide.addText("旧 · Returning student", {
      x: ID_X,
      y: 3.9,
      w: 3.2,
      h: 0.3,
      fontFace: FONT_BODY,
      fontSize: 10,
      color: COLOR.cinnabar,
      bold: true,
      charSpacing: 2,
    });
  }

  // Meta block — 2 columns × 3 rows
  const age = computeAge(row.birth_date);
  const meta: Array<[string, string]> = [
    ["Gender · 性别", formatGender(row.gender)],
    ["Religion · 宗教", row.religion ?? "—"],
    ["DOB · 生日", row.birth_date ?? "—"],
    ["Age · 年龄", age !== null ? `${age}` : "—"],
    ["Industry · 行业", row.industry ?? "—"],
    ["Position · 职位", row.occupation ?? "—"],
  ];
  const META_Y = 4.4;
  const COL_W = (ID_W - 0.4) / 2;
  meta.forEach(([k, v], i) => {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const cx = ID_X + col * (COL_W + 0.4);
    const cy = META_Y + r * 0.55;
    slide.addText(k, {
      x: cx,
      y: cy,
      w: COL_W,
      h: 0.22,
      fontFace: FONT_BODY,
      fontSize: 9,
      color: COLOR.inkFaint,
      bold: true,
      charSpacing: 2,
    });
    slide.addText(v, {
      x: cx,
      y: cy + 0.2,
      w: COL_W,
      h: 0.28,
      fontFace: FONT_BODY,
      fontSize: 12,
      color: COLOR.ink,
    });
  });

  // ---- Course history (bottom strip across full width) -----------------
  const HIST_Y = 6.2;
  slide.addText("曾参加课程 · COURSE HISTORY", {
    x: M,
    y: HIST_Y,
    w: SLIDE_W - M * 2,
    h: 0.25,
    fontFace: FONT_BODY,
    fontSize: 9,
    bold: true,
    color: COLOR.inkFaint,
    charSpacing: 3,
  });

  const courseText = formatCourseList(row.attended_courses);
  slide.addText(courseText, {
    x: M,
    y: HIST_Y + 0.3,
    w: SLIDE_W - M * 2 - 2.5,
    h: 0.5,
    fontFace: FONT_BODY,
    fontSize: 11,
    color: courseText === "—" ? COLOR.inkFaint : COLOR.ink,
    italic: courseText === "—",
  });

  // ---- Enrollment status (bottom-right pill) ---------------------------
  const status = STATUS_LABEL[row.enrollment_status] ?? {
    en: row.enrollment_status,
    cn: row.enrollment_status,
  };
  const isPaid = row.enrollment_status === "paid";
  slide.addShape("roundRect", {
    x: SLIDE_W - 2.2 - M,
    y: HIST_Y + 0.25,
    w: 2.2,
    h: 0.5,
    fill: { color: isPaid ? COLOR.cinnabar : COLOR.paperDeep },
    line: { color: isPaid ? COLOR.cinnabar : COLOR.paperShadow, width: 0.5 },
    rectRadius: 0.25,
  });
  slide.addText(`${status.cn} · ${status.en.toUpperCase()}`, {
    x: SLIDE_W - 2.2 - M,
    y: HIST_Y + 0.28,
    w: 2.2,
    h: 0.45,
    fontFace: FONT_BODY,
    fontSize: 11,
    bold: true,
    color: isPaid ? COLOR.paper : COLOR.ink,
    align: "center",
    valign: "middle",
    charSpacing: 2,
  });

  // ---- Footer ----------------------------------------------------------
  slide.addText(`${event.slug} · slide ${slideIndex}`, {
    x: M,
    y: SLIDE_H - 0.3,
    w: SLIDE_W - M * 2,
    h: 0.22,
    fontFace: FONT_BODY,
    fontSize: 8,
    color: COLOR.inkFaint,
    align: "right",
    charSpacing: 1,
  });
}

// ---------------------------------------------------------------------------
// Compact mode — 3 horizontal cards per A4 portrait page
// ---------------------------------------------------------------------------

function buildCompactSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  event: ProfileDeckEventMeta,
  batch: ProfileDeckRow[],
  slideIndex: number,
  photoByPid: Map<string, PhotoAsset>,
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // Page header — small editorial chrome
  slide.addText("学员名册 · STUDENT PROFILE", {
    x: A4_M,
    y: A4_M,
    w: A4_W - A4_M * 2 - 2,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 3,
  });

  const titleParts = [event.title_cn, event.title_en, event.slug].filter(
    Boolean,
  );
  const titleLine = titleParts[0] ?? event.slug;
  slide.addText(titleLine, {
    x: A4_M,
    y: A4_M + 0.28,
    w: A4_W - A4_M * 2 - 2,
    h: 0.28,
    fontFace: FONT_TITLE,
    fontSize: 13,
    color: COLOR.ink,
    bold: true,
  });

  slide.addText(`Page ${slideIndex}`, {
    x: A4_W - A4_M - 2,
    y: A4_M + 0.05,
    w: 2,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: COLOR.inkFaint,
    align: "right",
    charSpacing: 1,
  });

  // 3 cards stacked
  batch.forEach((row, idx) => {
    const cardY =
      A4_M + COMPACT_HEADER_H + idx * (COMPACT_CARD_H + COMPACT_GAP);
    buildCompactCard(
      slide,
      row,
      A4_M,
      cardY,
      COMPACT_CARD_W,
      COMPACT_CARD_H,
      photoByPid.get(row.participant_id) ?? null,
    );
  });

  // Footer
  slide.addText(`${event.slug} · printed ${new Date().toISOString().slice(0, 10)}`, {
    x: A4_M,
    y: A4_H - A4_M + 0.05,
    w: A4_W - A4_M * 2,
    h: 0.2,
    fontFace: FONT_BODY,
    fontSize: 7,
    color: COLOR.inkFaint,
    align: "right",
    charSpacing: 1,
  });
}

function buildCompactCard(
  slide: PptxGenJSType.Slide,
  row: ProfileDeckRow,
  x: number,
  y: number,
  w: number,
  h: number,
  photo: PhotoAsset | null,
) {
  // 3-column briefing-card layout, mirrors Dr Wu's 学员名册 print:
  //   Column 1: chip stack (top) + photo (rest)
  //   Column 2: 个人信息 — name + meta grid
  //   Column 3: 上课信息 (top) + 客服建议 (bottom)
  //
  // Cinnabar-tinted grey banner heads each section to match the print.

  // Frame
  slide.addShape("rect", {
    x,
    y,
    w,
    h,
    fill: { color: COLOR.paper },
    line: { color: COLOR.paperShadow, width: 0.5 },
  });
  slide.addShape("rect", {
    x,
    y,
    w: 0.05,
    h,
    fill: { color: COLOR.cinnabar },
    line: { color: COLOR.cinnabar },
  });

  const pad = 0.1;
  const innerX = x + pad + 0.05;
  const innerY = y + pad;
  const innerR = x + w - pad;
  const innerB = y + h - pad;

  // Column geometry — 3 cols.
  const colW1 = 1.45; // photo + chips
  const colGap = 0.12;
  const remaining = innerR - innerX - colW1 - colGap * 2;
  const colW2 = remaining * 0.52;
  const colW3 = remaining * 0.48;
  const col1X = innerX;
  const col2X = col1X + colW1 + colGap;
  const col3X = col2X + colW2 + colGap;

  // ====================================================================
  // COL 1 — chip stack + photo
  // ====================================================================
  // Chip stack header (the cinnabar-wash row on the top-left of the print).
  // Show "SG · 新加坡" when only the ISO code is set; sub_region overrides
  // (it's already free text like "北马" — admin chose how it reads).
  const chipH = 0.32;
  const subRegionText = row.sub_region
    ? row.sub_region
    : row.region
      ? (REGION_NAME[row.region]
          ? `${row.region} · ${REGION_NAME[row.region].cn}`
          : row.region)
      : "—";

  slide.addShape("rect", {
    x: col1X,
    y: innerY,
    w: colW1,
    h: chipH,
    fill: { color: COLOR.cinnabarWash },
    line: { color: COLOR.cinnabarSoft, width: 0.4 },
  });
  slide.addText(subRegionText, {
    x: col1X,
    y: innerY,
    w: colW1,
    h: chipH,
    fontFace: FONT_TITLE,
    fontSize: 11,
    color: COLOR.cinnabarDeep,
    bold: true,
    align: "center",
    valign: "middle",
  });

  // Two chips below the country chip:
  //   Left  — 新人 / 旧学员 (always shown; binary attendee status)
  //   Right — programme tier 丰盛 / 荣贵 / 精英文化财 / 荣耀文化财 (only
  //           when the participant has one — most don't yet, so the
  //           OS chip auto-centres alone)
  const chip2Y = innerY + chipH + 0.04;
  const chipSubH = 0.24;
  const chipGapX = 0.05;
  const hasProgramme = !!row.programme_tier;
  const chipW = hasProgramme
    ? (colW1 - chipGapX) / 2
    : colW1 * 0.65;
  const osChipX = hasProgramme
    ? col1X
    : col1X + (colW1 - chipW) / 2;

  slide.addShape("rect", {
    x: osChipX,
    y: chip2Y,
    w: chipW,
    h: chipSubH,
    fill: { color: row.is_old_student ? COLOR.cinnabarWash : COLOR.paper },
    line: { color: COLOR.cinnabarSoft, width: 0.4 },
  });
  slide.addText(row.is_old_student ? "旧学员" : "新人", {
    x: osChipX,
    y: chip2Y,
    w: chipW,
    h: chipSubH,
    fontFace: FONT_TITLE,
    fontSize: 9.5,
    color: COLOR.cinnabarDeep,
    bold: true,
    align: "center",
    valign: "middle",
  });

  if (hasProgramme && row.programme_tier) {
    const progChipX = col1X + chipW + chipGapX;
    slide.addShape("rect", {
      x: progChipX,
      y: chip2Y,
      w: chipW,
      h: chipSubH,
      fill: { color: COLOR.goldSoft },
      line: { color: COLOR.gold, width: 0.4 },
    });
    slide.addText(PROGRAMME_LABEL[row.programme_tier].cn, {
      x: progChipX,
      y: chip2Y,
      w: chipW,
      h: chipSubH,
      fontFace: FONT_TITLE,
      fontSize: 9.5,
      color: COLOR.ink,
      bold: true,
      align: "center",
      valign: "middle",
    });
  }

  // Photo cell adapts to the uploaded photo's native aspect ratio. Width
  // is fixed at the column width; height derives from the photo so the
  // image fills its cell edge-to-edge — no crop, no padding around it.
  // Below the photo is plain card background (paper-warm), not a frame.
  const photoY = chip2Y + chipSubH + 0.06;
  const photoMaxH = innerB - photoY;
  const photoX = col1X;
  const photoW = colW1;
  const photoH = photo
    ? Math.min(photoMaxH, photoW / photo.aspect)
    : photoMaxH;
  if (photo) {
    slide.addImage({
      data: photo.dataUrl,
      x: photoX,
      y: photoY,
      w: photoW,
      h: photoH,
      sizing: { type: "contain", w: photoW, h: photoH },
      rounding: false,
    });
  } else {
    slide.addShape("rect", {
      x: photoX,
      y: photoY,
      w: photoW,
      h: photoH,
      fill: { color: COLOR.paperDeep },
      line: { color: COLOR.paperShadow, width: 0.4 },
    });
    slide.addText(deriveInitials(row), {
      x: photoX,
      y: photoY,
      w: photoW,
      h: photoH,
      fontFace: FONT_TITLE,
      fontSize: 48,
      color: COLOR.cinnabarSoft,
      align: "center",
      valign: "middle",
      bold: true,
    });
  }

  // ====================================================================
  // COL 2 — 个人信息 · Personal Info
  // ====================================================================
  const c2Y = innerY;
  drawSectionBanner(slide, col2X, c2Y, colW2, "个人信息", "PERSONAL INFO");

  // Big bilingual name + status row.
  const nameY = c2Y + 0.34;
  const nameCn = row.name_cn ?? "";
  const nameEn = row.name_en ?? row.region_id ?? "—";

  if (nameCn) {
    slide.addText(nameCn, {
      x: col2X,
      y: nameY,
      w: colW2,
      h: 0.5,
      fontFace: FONT_TITLE,
      fontSize: 24,
      color: COLOR.ink,
      bold: true,
    });
    slide.addText(nameEn, {
      x: col2X,
      y: nameY + 0.46,
      w: colW2,
      h: 0.22,
      fontFace: FONT_TITLE,
      fontSize: 10,
      color: COLOR.inkSoft,
      italic: true,
    });
  } else {
    slide.addText(nameEn, {
      x: col2X,
      y: nameY,
      w: colW2,
      h: 0.5,
      fontFace: FONT_TITLE,
      fontSize: 20,
      color: COLOR.ink,
      bold: true,
    });
  }

  // Status chips: gender · religion · age — three separate cinnabar-wash
  // chips. Matches the screenshot's chip strip under the bilingual name.
  const age = computeAge(row.birth_date);
  const chipStripY = nameY + 0.74;
  const chipStripH = 0.26;
  const chipStripGap = 0.06;
  const chipStripW = (colW2 - chipStripGap * 2) / 3;
  const chipBits: Array<string | null> = [
    formatGenderShort(row.gender),
    row.religion,
    age !== null ? `${age}岁` : null,
  ];
  chipBits.forEach((text, idx) => {
    if (!text) return;
    const cx = col2X + idx * (chipStripW + chipStripGap);
    slide.addShape("rect", {
      x: cx,
      y: chipStripY,
      w: chipStripW,
      h: chipStripH,
      fill: { color: COLOR.cinnabarWash },
      line: { color: COLOR.cinnabarSoft, width: 0.4 },
    });
    slide.addText(text, {
      x: cx,
      y: chipStripY,
      w: chipStripW,
      h: chipStripH,
      fontFace: FONT_TITLE,
      fontSize: 9.5,
      color: COLOR.cinnabarDeep,
      bold: true,
      align: "center",
      valign: "middle",
    });
  });

  // Field rows (with 介绍人 added as the 6th row).
  const c2FieldsY = chipStripY + chipStripH + 0.12;
  const c2Fields: Array<[string, string | null]> = [
    ["出生日期", row.birth_date],
    ["健康状况", row.health_status],
    ["家庭情况", row.family_situation],
    ["职业职位", row.occupation],
    ["公司行业", row.industry],
    ["介绍人", row.referrer_name],
  ];
  drawFieldRows(slide, c2FieldsY, col2X, colW2, c2Fields, {
    bottomLimit: innerB,
  });

  // ====================================================================
  // COL 3 — 上课信息 + 客服建议
  // ====================================================================
  drawSectionBanner(slide, col3X, c2Y, colW3, "上课信息", "CLASS INFO");
  const c3aFieldsY = c2Y + 0.34;
  const c3aFields: Array<[string, string | null]> = [
    [
      "组号",
      row.group_no !== null
        ? `${row.group_no}组${row.group_class ? ` · ${CLASS_LABEL[row.group_class].cn}` : ""}`
        : null,
    ],
    [
      "组长",
      row.group_leader_names.length > 0
        ? row.group_leader_names.join("、")
        : null,
    ],
    [
      "上课语种",
      row.language_fluency === "cn"
        ? "中文"
        : row.language_fluency === "en"
          ? "英文"
          : row.language_fluency === "both"
            ? "中英文"
            : null,
    ],
    ["饮食需求", row.dietary_needs],
  ];
  const c3aHeight = drawFieldRows(slide, c3aFieldsY, col3X, colW3, c3aFields);

  const c3bY = c3aFieldsY + c3aHeight + 0.1;
  drawSectionBanner(slide, col3X, c3bY, colW3, "客服建议", "CS NOTES");
  const c3bFieldsY = c3bY + 0.34;
  const c3bFields: Array<[string, string | null]> = [
    ["性格", row.personality],
    ["注意事项", row.interaction_notes],
    ["上课的需求点", row.course_needs],
    ["建议在谁的小组", row.suggested_group_leader_notes],
    ["提升潜力", upgradeLabel(row.upgrade_potential)],
    ["不允许报的课", row.forbidden_courses],
    ["客服评价", row.cs_evaluation],
  ];
  drawFieldRows(slide, c3bFieldsY, col3X, colW3, c3bFields, {
    bottomLimit: innerB,
  });
}

function upgradeLabel(v: "low" | "medium" | "high" | null): string | null {
  if (!v) return null;
  if (v === "low") return "低 · Low";
  if (v === "medium") return "中 · Medium";
  return "高 · High";
}

function formatGenderShort(g: string | null): string | null {
  if (!g) return null;
  const map: Record<string, string> = {
    male: "男 · M",
    female: "女 · F",
    other: "Other",
    undisclosed: "—",
  };
  return map[g] ?? g;
}

// Section banner — the grey-with-cinnabar-title row at the top of each
// column block, mirroring Dr Wu's print.
function drawSectionBanner(
  slide: PptxGenJSType.Slide,
  x: number,
  y: number,
  w: number,
  titleCn: string,
  titleEn: string,
) {
  slide.addShape("rect", {
    x,
    y,
    w,
    h: 0.28,
    fill: { color: COLOR.paperDeep },
    line: { color: COLOR.paperShadow, width: 0.4 },
  });
  slide.addText(titleCn, {
    x: x + 0.1,
    y,
    w: w - 0.2,
    h: 0.28,
    fontFace: FONT_TITLE,
    fontSize: 11,
    color: COLOR.cinnabarDeep,
    bold: true,
    align: "center",
    valign: "middle",
  });
  slide.addText(titleEn, {
    x: x + 0.1,
    y,
    w: w - 0.2,
    h: 0.28,
    fontFace: FONT_BODY,
    fontSize: 6.5,
    color: COLOR.inkFaint,
    bold: true,
    align: "right",
    valign: "middle",
    charSpacing: 1,
  });
}

// Field rows — label CN on left in cinnabar (narrow column), value on
// right. Skips rows whose value is null/empty. Returns the total height
// used.
function drawFieldRows(
  slide: PptxGenJSType.Slide,
  y: number,
  x: number,
  w: number,
  fields: Array<[string, string | null]>,
  opts: { maxRows?: number; bottomLimit?: number } = {},
): number {
  // 4 CN chars at 8.5pt need ~0.5" — widen the label column to give
  // 组别角色 / 上课语种 / 饮食需求 / 注意事项 etc. room on one line.
  const labelW = 0.85;
  const rowH = 0.22;
  let cy = y;
  let rowsRendered = 0;

  for (const [label, value] of fields) {
    if (!value || !value.trim()) continue;
    const valueH = value.length > 30 ? rowH * 2 : rowH;
    if (opts.bottomLimit && cy + valueH > opts.bottomLimit) break;
    if (opts.maxRows && rowsRendered >= opts.maxRows) break;

    slide.addText(label, {
      x,
      y: cy,
      w: labelW,
      h: rowH,
      fontFace: FONT_TITLE,
      fontSize: 8.5,
      color: COLOR.cinnabarDeep,
      bold: true,
      align: "right",
      valign: "top",
    });
    slide.addText(value, {
      x: x + labelW + 0.06,
      y: cy,
      w: w - labelW - 0.06,
      h: valueH,
      fontFace: FONT_BODY,
      fontSize: 8.5,
      color: COLOR.ink,
      valign: "top",
    });

    cy += valueH + 0.02;
    rowsRendered += 1;
  }

  return cy - y;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveInitials(row: ProfileDeckRow): string {
  const cn = row.name_cn?.trim();
  if (cn) return cn.slice(0, 1);
  const en = (row.name_en ?? "").trim();
  if (!en) return "·";
  const parts = en.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return en.slice(0, 2).toUpperCase();
}

function computeAge(birth: string | null): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function formatGender(g: string | null): string {
  if (!g) return "—";
  const map: Record<string, string> = {
    male: "男 · Male",
    female: "女 · Female",
    other: "Other",
    undisclosed: "—",
  };
  return map[g] ?? g;
}

function formatCourseList(list: AttendedCourse[]): string {
  if (!list || list.length === 0) return "—";
  return list
    .map((c) => {
      const tier = c.programme_tier ? PROGRAMME_LABEL[c.programme_tier].cn : null;
      const tail = [tier, c.date].filter(Boolean).join(" · ");
      return tail ? `${c.course_name} (${tail})` : c.course_name;
    })
    .join("   ·   ");
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`photo fetch ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("reader_failed"));
    reader.readAsDataURL(blob);
  });
}

// Probe a data-URL image's native dimensions and return width / height
// (the aspect ratio). Falls back to 4/7 (the deck cell's prior default
// aspect) if the image fails to decode for any reason — callers then
// render the photo at that default shape.
async function imageAspect(dataUrl: string): Promise<number> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return img.naturalWidth / img.naturalHeight;
    }
  } catch {
    /* fall through */
  }
  return 4 / 7;
}
