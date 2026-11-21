"use client";

import QRCode from "qrcode";
import { BADGE_H, BADGE_W, NAME_MAX_H, NAME_MAX_W, NAME_MIN_H } from "./layout";

// Browser-side drawing primitives shared by the live preview and the PDF
// renderer, so what the admin sees is what prints.
//
// WHY THE NAME IS A RASTER: jsPDF ships Latin-only fonts, and embedding a CJK
// font means ~8 MB loaded into its VFS on every export (names are dynamic, so
// it can't be subset ahead of time). Instead the name is drawn on a canvas
// with the machine's own CJK font at print resolution and placed as a PNG.
// The QR stays VECTOR (see qrRuns) so it scans crisply at any size.

export const NAME_FONT_STACK =
  '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei","Source Han Sans SC",sans-serif';

/** Print resolution for raster parts, in pixels per mm (~500 DPI). */
export const PX_PER_MM = 500 / 25.4;

const LINE_HEIGHT = 1.15;

type NameLayout = { lines: string[]; fontMm: number };

function fits(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  fontMm: number,
): boolean {
  ctx.font = `700 ${fontMm * PX_PER_MM}px ${NAME_FONT_STACK}`;
  return lines.every((l) => ctx.measureText(l).width <= NAME_MAX_W * PX_PER_MM);
}

/**
 * Largest size (≤ NAME_MAX_H) at which the name fits the badge width.
 * Chinese names stay on one line. A long English name that still doesn't fit
 * at NAME_MIN_H splits onto two lines at the space nearest the middle; a
 * single unbreakable word just keeps shrinking.
 */
export function layoutName(
  ctx: CanvasRenderingContext2D,
  name: string,
): NameLayout {
  const step = 0.25;
  for (let mm = NAME_MAX_H; mm >= NAME_MIN_H; mm -= step) {
    if (fits(ctx, [name], mm)) return { lines: [name], fontMm: mm };
  }

  const spaces = [...name.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (spaces.length > 0) {
    const mid = name.length / 2;
    const cut = spaces.reduce((best, i) =>
      Math.abs(i - mid) < Math.abs(best - mid) ? i : best,
    );
    const lines = [name.slice(0, cut).trim(), name.slice(cut + 1).trim()];
    for (let mm = NAME_MAX_H * 0.8; mm >= NAME_MIN_H * 0.8; mm -= step) {
      if (fits(ctx, lines, mm)) return { lines, fontMm: mm };
    }
  }

  let mm = NAME_MIN_H;
  while (mm > 2 && !fits(ctx, [name], mm)) mm -= step;
  return { lines: [name], fontMm: mm };
}

export type NameImage = {
  dataUrl: string;
  /** Rendered block size in mm — place centred on the name line. */
  wMm: number;
  hMm: number;
};

/** Renders the name as a transparent PNG trimmed to the text block. */
export function renderNameImage(name: string, color: string): NameImage | null {
  const text = name.trim();
  if (!text) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { lines, fontMm } = layoutName(ctx, text);
  const fontPx = fontMm * PX_PER_MM;
  ctx.font = `700 ${fontPx}px ${NAME_FONT_STACK}`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const linePx = fontPx * LINE_HEIGHT;

  canvas.width = Math.ceil(widest + fontPx * 0.1);
  canvas.height = Math.ceil(linePx * lines.length);
  // Resizing resets context state — set it again.
  ctx.font = `700 ${fontPx}px ${NAME_FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    ctx.fillText(l, canvas.width / 2, linePx * (i + 0.5));
  });

  return {
    dataUrl: canvas.toDataURL("image/png"),
    wMm: canvas.width / PX_PER_MM,
    hMm: canvas.height / PX_PER_MM,
  };
}

/**
 * QR as horizontal runs of dark modules: [row, startCol, length]. Merging
 * runs cuts the rectangle count ~4× versus one rect per module, which keeps
 * a 500-badge PDF small, and leaves light modules undrawn (transparent) so
 * the design shows through like the sample.
 */
export function qrRuns(token: string): { size: number; runs: Array<[number, number, number]> } {
  const qr = QRCode.create(token, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const runs: Array<[number, number, number]> = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.modules.get(r, c)) c++;
      runs.push([r, start, c - start]);
    }
  }
  return { size: n, runs };
}

/**
 * WCAG contrast ratio between two hex colours (1–21). Used to warn when the
 * plate and its QR are too close to scan — the plate exists precisely for
 * scanners that need strong contrast.
 */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this the plate warns; dark-on-light at ≥ 4.5 scans dependably. */
export const MIN_PLATE_CONTRAST = 4.5;

/**
 * Does the machine have one of the CJK fonts we ask for? `document.fonts.check`
 * is useless here (true for any system font name, installed or not), so
 * compare rendered widths against two generic fallbacks: an installed font
 * changes the width versus both.
 */
export function detectCjkFont(): string | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  // Latin letters in the sample on purpose: CJK glyphs are full-width (1em)
  // in nearly every font, so a CJK-only sample measures the same whether or
  // not the font exists. The fonts' Latin glyphs are what tell them apart.
  const sample = "Apple Wiq 名牌";
  const width = (family: string) => {
    ctx.font = `700 100px ${family}`;
    return ctx.measureText(sample).width;
  };
  const mono = width("monospace");
  const serif = width("serif");
  for (const f of ["PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", "Source Han Sans SC"]) {
    if (width(`"${f}",monospace`) !== mono || width(`"${f}",serif`) !== serif) {
      return f;
    }
  }
  return null;
}

/** Load the design and cover-crop it to the badge's 54:85 aspect as a JPEG. */
export async function loadBackground(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("background_fetch_failed");
  const bmp = await createImageBitmap(await res.blob());

  const pxPerMm = 450 / 25.4;
  const w = Math.round(BADGE_W * pxPerMm);
  const h = Math.round(BADGE_H * pxPerMm);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.92);
}
