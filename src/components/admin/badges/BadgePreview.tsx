"use client";

import { useEffect, useRef, useState } from "react";
import { BADGE_H, BADGE_W, nameCenterY, qrBox } from "@/lib/badges/layout";
import { qrRuns, renderNameImage } from "@/lib/badges/draw";
import type { BadgeSettings } from "@/lib/badges/types";

// One badge, drawn with the same layout maths + name renderer + QR runs as
// the PDF, so the preview is a faithful proof rather than a CSS mock-up.

const CSS_PX_PER_MM = 5; // 270 × 425 CSS px on screen

type Props = {
  settings: BadgeSettings;
  name: string;
  token: string;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}

export function BadgePreview({ settings, name, token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [bgError, setBgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBgError(false);
    if (!settings.bg_url) {
      setBg(null);
      return;
    }
    loadImage(settings.bg_url)
      .then((img) => !cancelled && setBg(img))
      .catch(() => !cancelled && setBgError(true));
    return () => {
      cancelled = true;
    };
  }, [settings.bg_url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      const dpr = window.devicePixelRatio || 1;
      const k = CSS_PX_PER_MM * dpr; // device px per mm
      canvas.width = Math.round(BADGE_W * k);
      canvas.height = Math.round(BADGE_H * k);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const nameImg = renderNameImage(name, settings.ink_color);
      const nameEl = nameImg ? await loadImage(nameImg.dataUrl) : null;
      if (cancelled) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bg) {
        const scale = Math.max(canvas.width / bg.width, canvas.height / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        ctx.drawImage(bg, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } else {
        // Neutral stand-in so a white ink colour is still visible.
        ctx.fillStyle = "#8A93A6";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (nameImg && nameEl) {
        const cy = nameCenterY(settings) * k;
        ctx.drawImage(
          nameEl,
          ((BADGE_W - nameImg.wMm) / 2) * k,
          cy - (nameImg.hMm / 2) * k,
          nameImg.wMm * k,
          nameImg.hMm * k,
        );
      }

      const box = qrBox(settings);
      const { size, runs } = qrRuns(token);
      const mod = (box.size / size) * k;
      const ox = box.x * k;
      const oy = box.y * k;
      if (settings.qr_plate) {
        const pad = mod * 2;
        ctx.fillStyle = settings.plate_fill;
        ctx.beginPath();
        ctx.roundRect(ox - pad, oy - pad, box.size * k + pad * 2, box.size * k + pad * 2, 1.5 * k);
        ctx.fill();
        ctx.fillStyle = settings.plate_ink;
      } else {
        ctx.fillStyle = settings.ink_color;
      }
      for (const [r, c, len] of runs) {
        ctx.fillRect(ox + c * mod, oy + r * mod, len * mod + 0.5, mod + 0.5);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bg, name, token, settings]);

  return (
    <figure className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Badge preview for ${name || "sample attendee"}`}
        style={{ width: BADGE_W * CSS_PX_PER_MM, height: BADGE_H * CSS_PX_PER_MM }}
        className="rounded-[3px] shadow-[0_1px_2px_rgba(15,30,60,0.10),0_12px_32px_-12px_rgba(15,30,60,0.35)]"
      />
      <figcaption className="mt-3 text-[11.5px] text-[var(--ink-mute)] text-center">
        {bgError
          ? "Couldn't load the design — try uploading it again."
          : "Actual size 54 × 85 mm · shown at about 1.3×"}
      </figcaption>
    </figure>
  );
}
