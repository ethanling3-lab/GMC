"use client";

import type { jsPDF as JsPDF } from "jspdf";
import {
  BADGE_H,
  BADGE_W,
  COLS,
  GRID_X0,
  GRID_Y0,
  PAGE_H,
  PER_PAGE,
  ROWS,
  nameCenterY,
  qrBox,
  slotOrigin,
} from "./layout";
import {
  loadBackground,
  qrRuns,
  renderNameImage,
} from "./draw";
import type { BadgeRow, BadgeSettings } from "./types";

// Client-side 名牌 PDF: A4 landscape, 5 × 2 badges of 54 × 85 mm per sheet.
// Loaded via dynamic import (like floor-plan/export-pdf) so jsPDF stays out of
// the page bundle until someone exports.
//
// Per badge: background design (embedded ONCE under an alias and reused —
// otherwise 500 copies of the image would bloat the file to hundreds of MB),
// the name as a print-resolution PNG, and the QR as vector rectangles.
// Each page gets crop marks; page 1 gets a 50 mm calibration bar so whoever
// prints can confirm the printer didn't "fit to page".

const BG_ALIAS = "badge-bg";
const MARK_LEN = 5;
const MARK_GAP = 1.5;

export type RenderProgress = (done: number, total: number) => void;

export async function renderBadgesPdf(
  rows: BadgeRow[],
  settings: BadgeSettings,
  onProgress?: RenderProgress,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const bg = settings.bg_url ? await loadBackground(settings.bg_url) : null;

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % PER_PAGE === 0) doc.addPage("a4", "landscape");
    if (i % PER_PAGE === 0) {
      drawPageChrome(doc, Math.floor(i / PER_PAGE), Math.ceil(rows.length / PER_PAGE));
    }
    const { x, y } = slotOrigin(i);
    drawBadge(doc, rows[i], settings, bg, x, y);

    // Yield every few badges so the progress label can repaint.
    if (i % 20 === 19) {
      onProgress?.(i + 1, rows.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(rows.length, rows.length);

  return doc.output("blob");
}

function drawBadge(
  doc: JsPDF,
  row: BadgeRow,
  s: BadgeSettings,
  bg: string | null,
  x: number,
  y: number,
) {
  if (bg) {
    doc.addImage(bg, "JPEG", x, y, BADGE_W, BADGE_H, BG_ALIAS, "FAST");
  } else {
    // No design uploaded yet — outline the badge so test prints still cut.
    doc.setDrawColor("#BBBBBB");
    doc.setLineWidth(0.2);
    doc.rect(x, y, BADGE_W, BADGE_H, "S");
  }

  const nameInk = s.ink_color;
  const name = renderNameImage(row.name, nameInk);
  if (name) {
    const cy = y + nameCenterY(s);
    doc.addImage(
      name.dataUrl,
      "PNG",
      x + (BADGE_W - name.wMm) / 2,
      cy - name.hMm / 2,
      name.wMm,
      name.hMm,
      undefined,
      "FAST",
    );
  }

  drawQr(doc, row.token, s, x, y);
}

function drawQr(doc: JsPDF, token: string, s: BadgeSettings, bx: number, by: number) {
  const box = qrBox(s);
  const { size, runs } = qrRuns(token);
  const mod = box.size / size;
  const ox = bx + box.x;
  const oy = by + box.y;

  if (s.qr_plate) {
    const pad = mod * 2; // ≥ 2-module quiet zone on the plate
    doc.setFillColor(s.plate_fill);
    doc.roundedRect(ox - pad, oy - pad, box.size + pad * 2, box.size + pad * 2, 1.5, 1.5, "F");
    doc.setFillColor(s.plate_ink);
  } else {
    doc.setFillColor(s.ink_color);
  }

  // A hair of overlap so adjacent rows don't show anti-aliasing seams.
  const bleed = 0.02;
  for (const [r, c, len] of runs) {
    doc.rect(ox + c * mod, oy + r * mod, len * mod + bleed, mod + bleed, "F");
  }
}

function drawPageChrome(doc: JsPDF, pageIndex: number, pageCount: number) {
  doc.setDrawColor("#888888");
  doc.setLineWidth(0.15);

  const top = GRID_Y0;
  const bottom = GRID_Y0 + ROWS * BADGE_H;
  const left = GRID_X0;
  const right = GRID_X0 + COLS * BADGE_W;

  // Vertical cut lines, marked above and below the grid.
  for (let c = 0; c <= COLS; c++) {
    const xx = GRID_X0 + c * BADGE_W;
    doc.line(xx, top - MARK_GAP - MARK_LEN, xx, top - MARK_GAP);
    doc.line(xx, bottom + MARK_GAP, xx, bottom + MARK_GAP + MARK_LEN);
  }
  // Horizontal cut lines, marked left and right of the grid.
  for (let r = 0; r <= ROWS; r++) {
    const yy = GRID_Y0 + r * BADGE_H;
    doc.line(left - MARK_GAP - MARK_LEN, yy, left - MARK_GAP, yy);
    doc.line(right + MARK_GAP, yy, right + MARK_GAP + MARK_LEN, yy);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor("#888888");
  doc.text(`${pageIndex + 1} / ${pageCount}`, right, PAGE_H - 6, { align: "right" });

  if (pageIndex === 0) {
    // 50 mm calibration bar — if it doesn't measure 50 mm, the printer scaled.
    const bx = left;
    const byy = PAGE_H - 8;
    doc.setLineWidth(0.3);
    doc.line(bx, byy, bx + 50, byy);
    doc.line(bx, byy - 1.5, bx, byy + 1.5);
    doc.line(bx + 50, byy - 1.5, bx + 50, byy + 1.5);
    doc.text(
      "50 mm - print at 100% / Actual size (not Fit to page)",
      bx + 53,
      byy + 1,
    );
  }
}
