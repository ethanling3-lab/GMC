"use client";

// Floor plan → PPT (.pptx) export.
//
// Slide deck structure:
//   1. Cover            — eyebrow + bilingual title + meta block
//   2. Plan             — full PNG of the canvas, fit-to-slide
//   3. Class summary    — tables/cushions count breakdown by class
//   4..N. Per-group     — group title + native pptx roster table
//
// We use native pptx text + tables (not flattened images) on every slide
// except the master plan, so admins can edit names / fix typos in
// PowerPoint after download. CJK renders cleanly because PowerPoint ships
// with its own CN font fallbacks; we don't have to embed a font subset.

import type PptxGenJSType from "pptxgenjs";
import { exportFloorPlanPng } from "./export-png";
import type {
  GroupClassKey,
  GroupRoster,
  GroupRosterMember,
  ProgrammeTier,
  SeatRole,
} from "@/components/admin/layout/types";
import type { EventMeta } from "./export-pdf";

export type PptxExportOptions = {
  pixelScale?: number;
  // When false, omit the cover slide (deck starts at the plan slide).
  // Default true.
  includeCover?: boolean;
  // When false, omit the class summary slide regardless of class data.
  // Default true (the slide still auto-skips when no group has a class).
  includeClassSummary?: boolean;
  // When false, omit the per-group roster slides (cover + plan + summary
  // only). Default true.
  includeRosters?: boolean;
};

// Editorial palette — pptxgenjs accepts hex without the leading "#".
const COLOR = {
  paper: "FBFCFF", // --paper-warm
  paperDeep: "E8EEFB", // --paper-deep
  paperShadow: "CEDAF0", // --paper-shadow
  ink: "0B2954", // --ink
  inkSoft: "1E3A6B", // --ink-soft
  inkFaint: "9DACC9", // --ink-faint
  cinnabar: "2563EB", // --cinnabar
  cinnabarDeep: "1848B8", // --cinnabar-deep
  cinnabarSoft: "7DA4F4", // --cinnabar-soft
  gold: "BFD2FA", // --gold
  goldSoft: "DCE6FB", // --gold-soft
};

const CLASS_LABEL: Record<GroupClassKey, { en: string; cn: string }> = {
  strategic: { en: "Strategic", cn: "战略" },
  key: { en: "Key", cn: "关键" },
  growth: { en: "Growth", cn: "成长" },
  maintenance: { en: "Maintenance", cn: "维护" },
};

const ROLE_LABEL: Record<SeatRole, string> = {
  zu_zhang: "组长",
  fu_zu_zhang: "副组长",
  pai_zhang: "排长",
  participant: "",
};

const PROGRAMME_LABEL: Record<ProgrammeTier, string> = {
  abundance: "丰",
  glorious_family: "贵",
  elite_cultural_heritage: "精",
  glorious_cultural_heritage: "耀",
};

// LAYOUT_WIDE = 13.333" × 7.5". Margins use a single unit (inches) so the
// math is uniform across slide builders.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const M = 0.5; // outer margin

// CN-friendly font stack. PowerPoint ships these on macOS + Windows;
// missing fallbacks degrade to system CJK without breaking layout.
const FONT_TITLE = "PingFang SC";
const FONT_BODY = "Helvetica Neue";

export async function exportFloorPlanPptx(
  svg: SVGSVGElement,
  meta: EventMeta,
  groups: GroupRoster[],
  opts: PptxExportOptions = {},
): Promise<Blob> {
  // Dynamic import — keeps pptxgenjs (~150 KB gzipped + JSZip dep) out of
  // the editor's first paint bundle.
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pres: InstanceType<typeof PptxGenJSType> = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const png = await exportFloorPlanPng(svg, {
    pixelScale: opts.pixelScale ?? 24,
  });
  const pngDataUrl = await blobToDataUrl(png);

  if (opts.includeCover !== false) {
    buildCoverSlide(pres, meta, groups);
  }
  buildPlanSlide(pres, meta, pngDataUrl);

  if (
    opts.includeClassSummary !== false
    && groups.some((g) => g.group_class !== null)
  ) {
    buildClassSummarySlide(pres, groups);
  }

  if (opts.includeRosters !== false) {
    for (const g of groups) {
      buildGroupSlide(pres, meta, g);
    }
  }

  // pptxgenjs returns ArrayBuffer | Blob | Uint8Array | string depending
  // on outputType. "blob" → Blob in browsers.
  const out = await pres.write({ outputType: "blob" });
  return out as Blob;
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function buildCoverSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  meta: EventMeta,
  groups: GroupRoster[],
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // Bottom band — paper-deep, gives the cover a visual baseline.
  slide.addShape("rect", {
    x: 0,
    y: SLIDE_H - 0.5,
    w: SLIDE_W,
    h: 0.5,
    fill: { color: COLOR.paperDeep },
    line: { color: COLOR.paperDeep },
  });

  // Eyebrow
  slide.addText("实名桌位图 · NAMED SEATING CHART", {
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

  // Title — bilingual stack, CN above, EN below.
  const titleCn = meta.title_cn ?? "";
  const titleEn = meta.title_en ?? meta.slug;
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

  // Meta block — 2 columns × 3 rows.
  const memberCount = groups.reduce((n, g) => n + g.members.length, 0);
  const meta1: Array<[string, string]> = [
    ["Event · 活动", meta.slug],
    ["Mode · 模式", meta.seating_mode === "tables" ? "Tables · 桌位" : "Cushions · 蒲团"],
    ["Generated · 生成时间", new Date().toLocaleString()],
  ];
  const meta2: Array<[string, string]> = [
    ["Groups · 分组", String(groups.length)],
    ["Members · 学员人数", String(memberCount)],
    ["", ""],
  ];

  drawMetaColumn(slide, meta1, M, 4.8);
  drawMetaColumn(slide, meta2, SLIDE_W / 2, 4.8);

  // Footer
  slide.addText(`GMC · ${meta.slug}`, {
    x: M,
    y: SLIDE_H - 0.4,
    w: 6,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: COLOR.inkFaint,
    charSpacing: 2,
  });
  slide.addText("Page 1", {
    x: SLIDE_W - 2,
    y: SLIDE_H - 0.4,
    w: 1.5,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: COLOR.inkFaint,
    align: "right",
  });
}

function drawMetaColumn(
  slide: PptxGenJSType.Slide,
  rows: Array<[string, string]>,
  x: number,
  y: number,
) {
  let cy = y;
  for (const [k, v] of rows) {
    if (!k) {
      cy += 0.7;
      continue;
    }
    slide.addText(k, {
      x,
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
      x,
      y: cy + 0.22,
      w: 5,
      h: 0.4,
      fontFace: FONT_BODY,
      fontSize: 16,
      color: COLOR.ink,
    });
    cy += 0.7;
  }
}

function buildPlanSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  meta: EventMeta,
  pngDataUrl: string,
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // Eyebrow
  slide.addText(`FLOOR PLAN · ${meta.slug.toUpperCase()}`, {
    x: M,
    y: 0.3,
    w: SLIDE_W - M * 2,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 11,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 3,
  });

  // PNG — fit to (slide minus margins minus eyebrow + footer chrome).
  const availW = SLIDE_W - M * 2;
  const availH = SLIDE_H - 0.8 - 0.4; // top eyebrow + bottom footer
  const aspect = 300 / 180; // floor-plan viewBox
  let imgW = availW;
  let imgH = imgW / aspect;
  if (imgH > availH) {
    imgH = availH;
    imgW = imgH * aspect;
  }
  const imgX = (SLIDE_W - imgW) / 2;
  const imgY = 0.8 + (availH - imgH) / 2;

  slide.addImage({
    data: pngDataUrl,
    x: imgX,
    y: imgY,
    w: imgW,
    h: imgH,
  });

  // Footer
  slide.addText(`Printed ${new Date().toISOString().slice(0, 10)}`, {
    x: M,
    y: SLIDE_H - 0.35,
    w: 6,
    h: 0.25,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: COLOR.inkFaint,
  });
}

function buildClassSummarySlide(
  pres: InstanceType<typeof PptxGenJSType>,
  groups: GroupRoster[],
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  slide.addText("CLASS BREAKDOWN · 分组分类", {
    x: M,
    y: 0.4,
    w: SLIDE_W - M * 2,
    h: 0.4,
    fontFace: FONT_BODY,
    fontSize: 12,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 3,
  });

  const counts: Record<GroupClassKey, { groups: number; members: number }> = {
    strategic: { groups: 0, members: 0 },
    key: { groups: 0, members: 0 },
    growth: { groups: 0, members: 0 },
    maintenance: { groups: 0, members: 0 },
  };
  for (const g of groups) {
    if (!g.group_class) continue;
    counts[g.group_class].groups += 1;
    counts[g.group_class].members += g.members.length;
  }

  const totalGroups = groups.length;
  const totalMembers = groups.reduce((n, g) => n + g.members.length, 0);

  const headerRow = [
    cell("CLASS · 类别", { bold: true, color: COLOR.inkFaint, fontSize: 10 }),
    cell("GROUPS · 组数", { bold: true, color: COLOR.inkFaint, fontSize: 10 }),
    cell("MEMBERS · 人数", { bold: true, color: COLOR.inkFaint, fontSize: 10 }),
    cell("SHARE · 占比", { bold: true, color: COLOR.inkFaint, fontSize: 10 }),
  ];

  const dataRows: PptxGenJSType.TableRow[] = (
    Object.keys(counts) as GroupClassKey[]
  ).map((k) => {
    const c = counts[k];
    const pct = totalMembers > 0 ? Math.round((c.members / totalMembers) * 100) : 0;
    return [
      cell(`${CLASS_LABEL[k].cn} · ${CLASS_LABEL[k].en}`, {
        fontSize: 14,
        color: COLOR.ink,
        bold: true,
      }),
      cell(String(c.groups), { fontSize: 14, color: COLOR.ink }),
      cell(String(c.members), { fontSize: 14, color: COLOR.ink }),
      cell(`${pct}%`, { fontSize: 14, color: COLOR.cinnabar, bold: true }),
    ];
  });

  const totalRow: PptxGenJSType.TableRow = [
    cell("Total · 合计", {
      fontSize: 13,
      color: COLOR.inkSoft,
      bold: true,
      italic: true,
    }),
    cell(String(totalGroups), { fontSize: 13, color: COLOR.inkSoft, bold: true }),
    cell(String(totalMembers), { fontSize: 13, color: COLOR.inkSoft, bold: true }),
    cell("100%", { fontSize: 13, color: COLOR.inkSoft, bold: true }),
  ];

  slide.addTable([headerRow, ...dataRows, totalRow], {
    x: M,
    y: 1.2,
    w: SLIDE_W - M * 2,
    colW: [4.5, 2.4, 2.4, SLIDE_W - M * 2 - 4.5 - 2.4 - 2.4],
    fontFace: FONT_BODY,
    border: { type: "solid", color: COLOR.paperShadow, pt: 0.5 },
  });
}

function buildGroupSlide(
  pres: InstanceType<typeof PptxGenJSType>,
  meta: EventMeta,
  g: GroupRoster,
) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.paper };

  // Eyebrow
  const classText = g.group_class
    ? `· ${CLASS_LABEL[g.group_class].cn} · ${CLASS_LABEL[g.group_class].en}`
    : "";
  slide.addText(`GROUP ${g.group_no} · 组 ${g.group_no} ${classText}`, {
    x: M,
    y: 0.4,
    w: SLIDE_W - M * 2,
    h: 0.35,
    fontFace: FONT_BODY,
    fontSize: 11,
    bold: true,
    color: COLOR.cinnabar,
    charSpacing: 3,
  });

  // Title — bilingual group name when present, fall back to "Group N".
  const titleCn = g.name_cn ?? "";
  const titleEn = g.name_en ?? `Group ${g.group_no}`;

  if (titleCn) {
    slide.addText(titleCn, {
      x: M,
      y: 0.85,
      w: SLIDE_W - M * 2,
      h: 0.7,
      fontFace: FONT_TITLE,
      fontSize: 32,
      color: COLOR.ink,
      bold: true,
    });
    slide.addText(titleEn, {
      x: M,
      y: 1.55,
      w: SLIDE_W - M * 2,
      h: 0.4,
      fontFace: FONT_TITLE,
      fontSize: 18,
      color: COLOR.inkSoft,
      italic: true,
    });
  } else {
    slide.addText(titleEn, {
      x: M,
      y: 0.95,
      w: SLIDE_W - M * 2,
      h: 0.7,
      fontFace: FONT_TITLE,
      fontSize: 32,
      color: COLOR.ink,
      bold: true,
    });
  }

  // Members table.
  const headerRow: PptxGenJSType.TableRow = [
    cell("#", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("ROLE · 角色", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("REGION ID", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("中文名", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("ENGLISH NAME", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("程度", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
    cell("OS", { bold: true, color: COLOR.inkFaint, fontSize: 9 }),
  ];

  const memberRows: PptxGenJSType.TableRow[] = g.members.map((m, i) => buildMemberRow(m, i + 1));

  slide.addTable([headerRow, ...memberRows], {
    x: M,
    y: 2.5,
    w: SLIDE_W - M * 2,
    colW: [0.5, 1.2, 1.4, 2.0, 2.8, 0.8, SLIDE_W - M * 2 - 0.5 - 1.2 - 1.4 - 2.0 - 2.8 - 0.8],
    fontFace: FONT_BODY,
    border: { type: "solid", color: COLOR.paperShadow, pt: 0.5 },
  });

  // Footer
  slide.addText(`${meta.slug} · group ${g.group_no} of total roster`, {
    x: M,
    y: SLIDE_H - 0.35,
    w: SLIDE_W - M * 2,
    h: 0.25,
    fontFace: FONT_BODY,
    fontSize: 8,
    color: COLOR.inkFaint,
    align: "right",
  });
}

function buildMemberRow(m: GroupRosterMember, seatNo: number): PptxGenJSType.TableRow {
  const role = ROLE_LABEL[m.role];
  const roleColor = m.role === "zu_zhang"
    ? COLOR.cinnabar
    : m.role === "fu_zu_zhang" || m.role === "pai_zhang"
      ? COLOR.cinnabarDeep
      : COLOR.inkFaint;

  return [
    cell(String(seatNo), { fontSize: 11, color: COLOR.inkFaint, bold: true }),
    cell(role, {
      fontSize: 11,
      color: role ? roleColor : COLOR.inkFaint,
      bold: !!role,
    }),
    cell(m.region_id ?? "—", { fontSize: 11, color: COLOR.inkSoft }),
    cell(m.name_cn ?? "—", { fontSize: 12, color: COLOR.ink, bold: true }),
    cell(m.name_en ?? "—", { fontSize: 11, color: COLOR.inkSoft }),
    cell(m.programme_tier ? PROGRAMME_LABEL[m.programme_tier] : "", {
      fontSize: 11,
      color: COLOR.cinnabar,
      bold: true,
    }),
    cell(m.is_old_student ? "旧" : "", {
      fontSize: 11,
      color: COLOR.cinnabar,
      bold: true,
    }),
  ];
}

// pptxgenjs cell helper — wraps the verbose options shape.
function cell(
  text: string,
  options: {
    fontSize: number;
    color: string;
    bold?: boolean;
    italic?: boolean;
  },
): PptxGenJSType.TableCell {
  return {
    text,
    options: {
      fontFace: FONT_BODY,
      fontSize: options.fontSize,
      color: options.color,
      bold: options.bold,
      italic: options.italic,
      valign: "middle",
    },
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
