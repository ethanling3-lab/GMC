"use client";

// Floor plan → PDF export.
//
// Two-page A3-landscape PDF by default:
//   1. Cover  — paper-warm bg, cinnabar eyebrow, display-serif title, meta
//                (slug · mode · table count · member count · generated-at).
//   2. Plan   — full PNG render of the canvas, fit-to-page with margins +
//                eyebrow + footer.
//
// Why no per-group roster pages: jsPDF's default fonts are Latin-only, so
// Chinese names fall back to mojibake unless we embed a CJK font (~2MB).
// The plan page already carries the bilingual seat names baked into the
// PNG, which is enough for venue use. Rich roster sheets ship in the PPT
// path (pptxgenjs handles CN natively) and can be added back here as a
// polish pass once we settle on a CJK font subset.

import type { jsPDF as JsPDF } from "jspdf";
import { exportFloorPlanPng } from "./export-png";
import type { GroupRoster } from "@/components/admin/layout/types";

export type PdfExportOptions = {
  pageSize?: "a3" | "a4";
  orientation?: "landscape" | "portrait";
  pixelScale?: number;
  // When false, omit the cover page — the PDF becomes a single plan page.
  // Default true.
  includeCover?: boolean;
};

export type EventMeta = {
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  seating_mode: "tables" | "cushions";
};

// Editorial palette (mirrors globals.css). Kept as RGB triplets so the
// jsPDF setFillColor / setTextColor calls compile under the strict overload
// that wants three numbers.
const RGB = {
  paper: [251, 252, 255] as const, // --paper-warm  #FBFCFF
  paperDeep: [232, 238, 251] as const, // --paper-deep  #E8EEFB
  ink: [11, 41, 84] as const, // --ink          #0B2954
  inkSoft: [30, 58, 107] as const, // --ink-soft     #1E3A6B
  inkFaint: [157, 172, 201] as const, // --ink-faint    #9DACC9
  cinnabar: [37, 99, 235] as const, // --cinnabar     #2563EB
};

const VB_W = 300; // mirrors floor-plan types
const VB_H = 180;

export async function exportFloorPlanPdf(
  svg: SVGSVGElement,
  meta: EventMeta,
  groups: GroupRoster[],
  opts: PdfExportOptions = {},
): Promise<Blob> {
  // Dynamic import — keeps jsPDF (~80 KB gzipped) out of the editor's first
  // paint bundle.
  const { jsPDF } = await import("jspdf");

  const pageSize = opts.pageSize ?? "a3";
  const orientation = opts.orientation ?? "landscape";

  const doc = new jsPDF({ orientation, unit: "mm", format: pageSize });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Render the canvas to PNG once. pixelScale 24 gives ~7200×4320 — about
  // 460dpi at A3 landscape, crisp for fine seat-name + label text. Bump
  // higher (32) for poster-grade prints; lower (16) if file size matters.
  const png = await exportFloorPlanPng(svg, {
    pixelScale: opts.pixelScale ?? 24,
  });
  const pngDataUrl = await blobToDataUrl(png);

  const includeCover = opts.includeCover !== false;
  if (includeCover) {
    paintCover(doc, W, H, meta, groups);
    doc.addPage();
  }
  paintPlanPage(doc, W, H, meta, pngDataUrl, includeCover ? 2 : 1, includeCover ? 2 : 1);

  return doc.output("blob");
}

// --- Helpers ----------------------------------------------------------------

function paintBg(
  doc: JsPDF,
  W: number,
  H: number,
  rgb: readonly [number, number, number],
) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(0, 0, W, H, "F");
}

function paintCover(
  doc: JsPDF,
  W: number,
  H: number,
  meta: EventMeta,
  groups: GroupRoster[],
) {
  paintBg(doc, W, H, RGB.paper);

  // A subtle paper-deep band along the bottom edge — gives the page a
  // visual baseline without competing with the title.
  doc.setFillColor(RGB.paperDeep[0], RGB.paperDeep[1], RGB.paperDeep[2]);
  doc.rect(0, H - 14, W, 14, "F");

  // Eyebrow
  doc.setTextColor(RGB.cinnabar[0], RGB.cinnabar[1], RGB.cinnabar[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("NAMED SEATING CHART", 24, 36, { charSpace: 1.4 });

  // Title — display serif. jsPDF's "times" is Latin-only; Chinese title
  // is intentionally dropped here (PNG plan carries the CN). title_en
  // first, fall back to slug.
  const title = meta.title_en || meta.title_cn || meta.slug;
  doc.setTextColor(RGB.ink[0], RGB.ink[1], RGB.ink[2]);
  doc.setFont("times", "normal");
  // Wrap the title within 80% of the page width so long names don't run
  // off the side.
  doc.setFontSize(40);
  const wrapped = doc.splitTextToSize(title, W * 0.8);
  doc.text(wrapped, 24, 60);

  // Meta block — left-aligned, two columns. Body sans.
  const memberCount = groups.reduce((n, g) => n + g.members.length, 0);
  const meta1: Array<[string, string]> = [
    ["Event", meta.slug],
    ["Mode", meta.seating_mode === "tables" ? "Tables" : "Cushions"],
  ];
  const meta2: Array<[string, string]> = [
    ["Groups", String(groups.length)],
    ["Members", String(memberCount)],
    ["Generated", new Date().toLocaleString()],
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  drawMetaBlock(doc, meta1, 24, 100);
  drawMetaBlock(doc, meta2, W / 2, 100);

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(RGB.inkFaint[0], RGB.inkFaint[1], RGB.inkFaint[2]);
  doc.text(`GMC · ${meta.slug}`, 24, H - 6);
  doc.text(`Page 1 of 2`, W - 24, H - 6, { align: "right" });
}

function drawMetaBlock(
  doc: JsPDF,
  rows: Array<[string, string]>,
  x: number,
  y: number,
) {
  let cy = y;
  for (const [k, v] of rows) {
    doc.setTextColor(RGB.inkFaint[0], RGB.inkFaint[1], RGB.inkFaint[2]);
    doc.setFontSize(8);
    doc.text(k.toUpperCase(), x, cy, { charSpace: 1.2 });
    doc.setTextColor(RGB.ink[0], RGB.ink[1], RGB.ink[2]);
    doc.setFontSize(13);
    doc.text(v, x, cy + 6);
    cy += 16;
  }
}

function paintPlanPage(
  doc: JsPDF,
  W: number,
  H: number,
  meta: EventMeta,
  pngDataUrl: string,
  pageNumber: number = 2,
  pageTotal: number = 2,
) {
  paintBg(doc, W, H, RGB.paper);

  // Header eyebrow
  doc.setTextColor(RGB.cinnabar[0], RGB.cinnabar[1], RGB.cinnabar[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`FLOOR PLAN · ${meta.slug.toUpperCase()}`, 14, 12, {
    charSpace: 1.2,
  });

  // Plan image — fit to page with margin.
  const marginX = 12;
  const marginTop = 18;
  const marginBottom = 14;
  const availW = W - marginX * 2;
  const availH = H - marginTop - marginBottom;
  const aspect = VB_W / VB_H;

  let imgW = availW;
  let imgH = imgW / aspect;
  if (imgH > availH) {
    imgH = availH;
    imgW = imgH * aspect;
  }
  const imgX = (W - imgW) / 2;
  const imgY = marginTop + (availH - imgH) / 2;

  // "SLOW" → best lossless PNG compression. The default "FAST" path
  // re-encodes aggressively and visibly softens text + thin lines on print.
  doc.addImage(pngDataUrl, "PNG", imgX, imgY, imgW, imgH, undefined, "SLOW");

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(RGB.inkFaint[0], RGB.inkFaint[1], RGB.inkFaint[2]);
  doc.text(
    `Printed ${new Date().toISOString().slice(0, 10)}`,
    14,
    H - 6,
  );
  doc.text(`Page ${pageNumber} of ${pageTotal}`, W - 14, H - 6, { align: "right" });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
