"use client";

// Floor plan → PNG export.
//
// Vanilla SVG-to-canvas pipeline: clone the live <svg>, neutralize the
// pan/zoom transform on the stage <g> (data-export-stage), inline CSS
// variable values so var(...) references resolve when the SVG is loaded
// as an <img>, embed any <image href> as a data URL (avoids canvas-taint
// + works around Supabase signed-URL CORS edge cases), serialize, draw to
// an offscreen <canvas> at the chosen resolution, return a PNG blob.
//
// Why vanilla over html-to-image: our root is a pure SVG element, fonts
// and image assets are well-bounded, and we already know exactly which
// CSS variables matter — pulling in a dep just to handle generic HTML
// trees is overkill.

import { VB_H, VB_W } from "@/components/admin/layout/types";

export type PngExportOptions = {
  // Multiplier on the source viewBox. e.g. pixelScale=12 → 3600×2160 PNG
  // (≈250dpi at A3 landscape). Default 12. Range advice: 8 = thumbnail,
  // 12 = standard print, 16 = high-res print, 20 = poster.
  pixelScale?: number;
  // Extra device-pixel multiplier applied AFTER pixelScale. Default 1.
  // Set 2 for retina-grade output (memory-heavy at large pixelScale).
  pixelRatio?: number;
  // Solid background fill drawn under the SVG. Default --paper-warm.
  background?: string;
};

const NS_SVG = "http://www.w3.org/2000/svg";
const NS_XLINK = "http://www.w3.org/1999/xlink";

// CSS variables consumed by the editor's SVG. Resolved from the live
// document and copy-pasted onto the clone's root <svg> as inline style so
// the cascade still resolves them once the SVG is detached.
const INLINED_VARS = [
  "--ink",
  "--ink-soft",
  "--ink-mute",
  "--ink-faint",
  "--paper",
  "--paper-deep",
  "--paper-shadow",
  "--paper-warm",
  "--cinnabar",
  "--cinnabar-deep",
  "--cinnabar-soft",
  "--cinnabar-wash",
  "--jade",
  "--jade-deep",
  "--jade-wash",
  "--gold",
  "--gold-soft",
];

export async function exportFloorPlanPng(
  liveSvg: SVGSVGElement,
  opts: PngExportOptions = {},
): Promise<Blob> {
  const pixelScale = opts.pixelScale ?? 12;
  const pixelRatio = opts.pixelRatio ?? 1;
  const background =
    opts.background ?? (readVar(liveSvg, "--paper-warm") || "#FBFCFF");

  // Wait for any pending font loads so labels render in the intended typeface.
  if (document.fonts && typeof document.fonts.ready?.then === "function") {
    try {
      await document.fonts.ready;
    } catch {
      // Non-fatal — proceed with whatever fonts the browser has.
    }
  }

  const clone = liveSvg.cloneNode(true) as SVGSVGElement;

  // Neutralize the pan/zoom transform that lives on the stage <g> so the
  // export captures the source viewBox (0,0,VB_W,VB_H) regardless of where
  // the user has scrolled / zoomed in the editor.
  const stage = clone.querySelector("[data-export-stage]") as SVGGElement | null;
  if (stage) {
    stage.removeAttribute("transform");
    stage.removeAttribute("style");
  }

  // Force the source viewBox + explicit dimensions so the rasterizer doesn't
  // pick up the live SVG's responsive width/height ("100%").
  const exportW = VB_W * pixelScale;
  const exportH = VB_H * pixelScale;
  clone.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`);
  clone.setAttribute("width", String(exportW));
  clone.setAttribute("height", String(exportH));
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", NS_SVG);

  inlineCssVars(liveSvg, clone);
  // Crisper rasterization at scale: prefer precise outlines over fast
  // hinting. Cheap to set and the browser respects these when the SVG is
  // loaded as an <img>.
  clone.setAttribute("text-rendering", "geometricPrecision");
  clone.setAttribute("shape-rendering", "geometricPrecision");
  await embedImages(clone);

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(exportW * pixelRatio);
    canvas.height = Math.round(exportH * pixelRatio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    // Highest-quality bilinear interp on the rasterizer side. Default is
    // "low" in some engines and noticeably softens labels at print scale.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// Trigger a browser download for a blob with a given filename.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke — some browsers cancel the download if revoked too soon.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

function readVar(node: Element, name: string): string {
  return window.getComputedStyle(node).getPropertyValue(name).trim();
}

function inlineCssVars(live: SVGSVGElement, clone: SVGSVGElement) {
  const cs = window.getComputedStyle(live);
  for (const v of INLINED_VARS) {
    const val = cs.getPropertyValue(v).trim();
    if (val) clone.style.setProperty(v, val);
  }
  // Also inline the computed font-family so SVG text picks up the editor's
  // fallback chain when rendered as an <img>.
  const family = cs.getPropertyValue("font-family").trim();
  if (family) clone.style.fontFamily = family;
}

async function embedImages(clone: SVGSVGElement) {
  const images = Array.from(clone.querySelectorAll("image"));
  await Promise.all(
    images.map(async (img) => {
      const href =
        img.getAttribute("href")
        ?? img.getAttributeNS(NS_XLINK, "href")
        ?? null;
      if (!href || href.startsWith("data:")) return;
      try {
        const res = await fetch(href, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.setAttribute("href", dataUrl);
        // Strip any legacy xlink:href so the data URL is the only winner.
        img.removeAttributeNS(NS_XLINK, "href");
      } catch {
        // CORS / 404 / network — drop the image so the export still produces
        // a valid PNG. The shapes layer renders fine without the background.
        img.parentElement?.removeChild(img);
      }
    }),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG → <img> load failed"));
    img.src = url;
  });
}
