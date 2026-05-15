// Client-only wrapper around @vladmandic/face-api.
// Mirrors face_analyzer.html sections 5–7: lazy model load, 4-pass
// detection, geometry measurement, skin-tone pixel sampling.
//
// Exported `analyzeImage` is the single entry point. Returns a result
// shape that the API route accepts directly.

import {
  classifyFace,
  classifySkinTone,
  type ArchetypeName,
  type FaceClassification,
  type FaceMeasurements,
  type SkinTone,
} from "./archetypes";

export type AnalysisOk = {
  ok: true;
  measurements: FaceMeasurements;
  classification: FaceClassification;
  archetype: ArchetypeName | "未分类";
};

export type AnalysisFail = {
  ok: false;
  error: "image_load_failed" | "no_face_detected" | "analysis_failed";
  errorMessage: string;
  diagTips: string[];
  imgSize: string | null;
};

export type AnalysisResult = AnalysisOk | AnalysisFail;

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
const MODEL_URL_FALLBACK =
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js/weights";

export type FaceApi = typeof import("@vladmandic/face-api");

type Globals = {
  __faceApi?: FaceApi;
  __faceApiReady?: boolean;
  __faceApiLoading?: Promise<void> | null;
};

function g(): Globals {
  return globalThis as unknown as Globals;
}

async function importFaceApi(): Promise<FaceApi> {
  const mod = (await import("@vladmandic/face-api")) as unknown as
    | FaceApi
    | { default: FaceApi };
  // Some bundlers wrap CJS interop into `.default`.
  return (mod as { default?: FaceApi }).default ?? (mod as FaceApi);
}

// Accessor for the cached face-api instance — exposed so the
// face-recognition pipeline can share the same module + model state
// without re-importing. Callers must `await loadModels()` first.
export function getLoadedFaceApi(): FaceApi | null {
  return g().__faceApi ?? null;
}

export async function loadModels(): Promise<void> {
  const globals = g();
  if (globals.__faceApiReady) return;
  if (globals.__faceApiLoading) return globals.__faceApiLoading;

  globals.__faceApiLoading = (async () => {
    const faceapi = await importFaceApi();
    let lastErr: unknown = null;
    for (const url of [MODEL_URL, MODEL_URL_FALLBACK]) {
      try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(url);
        await faceapi.nets.faceLandmark68Net.loadFromUri(url);
        // M7.1c — also load the 128-dim identity recognition model so
        // shared callers (face-reading + check-in face-match) only pay
        // the model-fetch cost once. Adds ~5MB to first-load weight.
        await faceapi.nets.faceRecognitionNet.loadFromUri(url);
        globals.__faceApi = faceapi;
        globals.__faceApiReady = true;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      lastErr instanceof Error
        ? `face-api model load failed: ${lastErr.message}`
        : "face-api model load failed",
    );
  })();

  try {
    await globals.__faceApiLoading;
  } finally {
    globals.__faceApiLoading = null;
  }
}

function loadImage(url: string, cors: boolean, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    const tid = window.setTimeout(() => {
      img.src = "";
      reject(new Error("image timeout"));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(tid);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(tid);
      reject(new Error("image error"));
    };
    img.src = url;
  });
}

function preprocessCanvas(
  img: HTMLImageElement,
  mode: "normal" | "contrast" | "bright" | "sharp",
): HTMLCanvasElement {
  const TARGET = 320;
  const w = img.naturalWidth || img.width || 640;
  const h = img.naturalHeight || img.height || 640;
  const scale = TARGET / Math.max(w, h, 1);
  const sw = Math.max(Math.round(w * scale), 1);
  const sh = Math.max(Math.round(h * scale), 1);

  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  if (mode === "contrast") ctx.filter = "contrast(140%) brightness(108%)";
  else if (mode === "bright") ctx.filter = "brightness(145%) contrast(115%)";
  else if (mode === "sharp") ctx.filter = "contrast(120%) saturate(90%)";
  else ctx.filter = "none";
  ctx.drawImage(img, 0, 0, sw, sh);
  ctx.filter = "none";
  return c;
}

function corsCanvasFromImage(img: HTMLImageElement): HTMLCanvasElement | null {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    // Force a pixel read to surface tainted-canvas errors here, not later.
    ctx.getImageData(0, 0, 1, 1);
    return c;
  } catch {
    return null;
  }
}

type DetResult = {
  detection: {
    landmarks: { positions: { x: number; y: number }[] };
    detection: { box: { x: number; y: number; width: number; height: number } };
  };
  pass: string | null;
  procW: number;
  procH: number;
} | null;

async function runDetectFace(
  faceapi: FaceApi,
  el: HTMLImageElement | HTMLCanvasElement,
) {
  const opts = new faceapi.SsdMobilenetv1Options({
    minConfidence: 0.15,
    maxResults: 1,
  });
  try {
    const det = await faceapi
      .detectSingleFace(el, opts)
      .withFaceLandmarks();
    return det ?? null;
  } catch {
    return null;
  }
}

async function detectMultiPass(
  faceapi: FaceApi,
  img: HTMLImageElement,
  hasCors: boolean,
): Promise<DetResult> {
  const imgW = img.naturalWidth || img.width || 320;
  const imgH = img.naturalHeight || img.height || 320;

  // Pass 0: direct img element (works even on cross-origin).
  const direct = await runDetectFace(faceapi, img);
  if (direct) {
    return {
      detection: direct as unknown as NonNullable<DetResult>["detection"],
      pass: null,
      procW: imgW,
      procH: imgH,
    };
  }

  if (!hasCors) {
    return null;
  }

  const passes: { mode: "normal" | "contrast" | "bright" | "sharp"; label: string }[] = [
    { mode: "normal", label: "缩放标准化" },
    { mode: "contrast", label: "对比度增强" },
    { mode: "bright", label: "亮度增强" },
    { mode: "sharp", label: "锐度优化" },
  ];
  for (const p of passes) {
    const canvas = preprocessCanvas(img, p.mode);
    const det = await runDetectFace(faceapi, canvas);
    if (det) {
      return {
        detection: det as unknown as NonNullable<DetResult>["detection"],
        pass: p.label,
        procW: canvas.width,
        procH: canvas.height,
      };
    }
  }
  return null;
}

function diagnoseFail(
  img: HTMLImageElement | null,
  corsCanvas: HTMLCanvasElement | null,
): string[] {
  const tips: string[] = [];
  const w = img?.naturalWidth ?? 0;
  const h = img?.naturalHeight ?? 0;

  if (w > 0 && h > 0 && (w < 200 || h < 200)) {
    tips.push(`🔸 分辨率过低（${w}×${h}px），建议使用 300×300 以上的照片`);
  }
  if (w > 0 && h > 0) {
    const ratio = h / w;
    if (ratio < 0.4) tips.push("🔸 图片为超宽横幅，疑似非人像照（如团体横幅、风景图）");
    else if (ratio > 3.0) tips.push("🔸 图片为超高竖幅，人脸在画面中占比可能过小");
  }
  if (corsCanvas) {
    try {
      const ctx = corsCanvas.getContext("2d");
      if (ctx) {
        const cw = corsCanvas.width;
        const ch = corsCanvas.height;
        let total = 0;
        let cnt = 0;
        const step = Math.max(1, Math.floor(Math.min(cw, ch) / 20));
        for (let x = 0; x < cw; x += step) {
          for (let y = 0; y < ch; y += step) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            total += (d[0] + d[1] + d[2]) / 3;
            cnt++;
          }
        }
        const avg = cnt > 0 ? total / cnt : 128;
        if (avg < 35)
          tips.push(`🔸 图片过暗（平均亮度 ${Math.round(avg)}/255），建议换光线充足的照片`);
        if (avg > 225)
          tips.push(`🔸 图片过亮/过曝（平均亮度 ${Math.round(avg)}/255），建议换正常曝光的照片`);
      }
    } catch {
      // tainted canvas — skip brightness check
    }
  }
  tips.push("💡 建议：①使用正面或小角度侧脸（偏转 < 45°）照片");
  tips.push("💡 ②面部不被口罩/头发/墨镜遮挡");
  tips.push("💡 ③人脸在画面中占 1/4 以上面积");
  tips.push("💡 ④照片清晰，非截图缩略图");
  return tips;
}

function buildMeasurements(
  detection: NonNullable<DetResult>["detection"],
  corsCanvas: HTMLCanvasElement | null,
  procW: number,
  procH: number,
  detPass: string | null,
): FaceMeasurements {
  const pts = detection.landmarks.positions;

  const W = corsCanvas ? corsCanvas.width : procW || 640;
  const H = corsCanvas ? corsCanvas.height : procH || 640;
  const sx = procW > 0 ? W / procW : 1;
  const sy = procH > 0 ? H / procH : 1;

  const jawXs = Array.from({ length: 17 }, (_, i) => pts[i].x);
  const faceWidth = Math.max(...jawXs) - Math.min(...jawXs);
  const chinY = pts[8].y;

  const browIdxs = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
  const browY = browIdxs.reduce((s, i) => s + pts[i].y, 0) / browIdxs.length;

  const eyeIdxs = [37, 38, 40, 41, 43, 44, 46, 47];
  const eyeY = eyeIdxs.reduce((s, i) => s + pts[i].y, 0) / eyeIdxs.length;
  const eyeToBrow = Math.max(browY - eyeY, 4);
  const foreheadTop = browY - eyeToBrow * 3.0;

  const faceHeight = chinY - foreheadTop;
  const faceRatio = faceHeight / Math.max(faceWidth, 1);

  const foreheadH = browY - foreheadTop;
  const noseBotY = pts[33].y;
  const lowerFaceH = chinY - noseBotY;
  const foreheadRatio = foreheadH / Math.max(lowerFaceH, 1);

  let skinTone: SkinTone = "黄";
  let skinRGB: FaceMeasurements["skinRGB"] = null;
  let skinCORS = false;

  if (!corsCanvas) {
    skinCORS = true;
  } else {
    try {
      const ctx = corsCanvas.getContext("2d");
      if (!ctx) {
        skinCORS = true;
      } else {
        const cheekIdxs = [2, 3, 4, 5, 11, 12, 13, 14];
        let rS = 0;
        let gS = 0;
        let bS = 0;
        let cnt = 0;
        for (const i of cheekIdxs) {
          const cx = Math.round(pts[i].x * sx);
          const cy = Math.round(pts[i].y * sy);
          for (let dx = -8; dx <= 8; dx++) {
            for (let dy = -8; dy <= 8; dy++) {
              const px = cx + dx;
              const py = cy + dy;
              if (px >= 0 && py >= 0 && px < W && py < H) {
                const d = ctx.getImageData(px, py, 1, 1).data;
                rS += d[0];
                gS += d[1];
                bS += d[2];
                cnt++;
              }
            }
          }
        }
        if (cnt > 0) {
          const r = rS / cnt;
          const gv = gS / cnt;
          const b = bS / cnt;
          skinTone = classifySkinTone(r, gv, b);
          skinRGB = {
            r: Math.round(r),
            g: Math.round(gv),
            b: Math.round(b),
          };
        }
      }
    } catch {
      skinCORS = true;
    }
  }

  return {
    faceRatio: +faceRatio.toFixed(3),
    foreheadRatio: +foreheadRatio.toFixed(3),
    faceWidth: +faceWidth.toFixed(2),
    faceHeight: +faceHeight.toFixed(2),
    foreheadH: +foreheadH.toFixed(2),
    lowerFaceH: +lowerFaceH.toFixed(2),
    skinTone,
    skinRGB,
    skinCORS,
    isNarrow: faceRatio >= 1.45,
    isHighForehead: foreheadRatio >= 0.95,
    detPass,
    corsLimited: skinCORS,
  };
}

export async function analyzeImage(imageUrl: string): Promise<AnalysisResult> {
  await loadModels();
  const faceapi = g().__faceApi;
  if (!faceapi) {
    return {
      ok: false,
      error: "analysis_failed",
      errorMessage: "face-api unavailable",
      diagTips: [],
      imgSize: null,
    };
  }

  // Try CORS first so we get pixel access for skin tone + brightness.
  let img: HTMLImageElement | null = null;
  let hasCors = false;
  try {
    img = await loadImage(imageUrl, true, 8000);
    hasCors = true;
  } catch {
    try {
      img = await loadImage(imageUrl, false, 8000);
      hasCors = false;
    } catch (err) {
      return {
        ok: false,
        error: "image_load_failed",
        errorMessage: err instanceof Error ? err.message : "image load failed",
        diagTips: [],
        imgSize: null,
      };
    }
  }

  const corsCanvas = hasCors ? corsCanvasFromImage(img) : null;
  const imgSize = `${img.naturalWidth || img.width}×${img.naturalHeight || img.height}`;

  let det: DetResult = null;
  try {
    det = await detectMultiPass(faceapi, img, hasCors && !!corsCanvas);
  } catch (err) {
    return {
      ok: false,
      error: "analysis_failed",
      errorMessage: err instanceof Error ? err.message : "detection failed",
      diagTips: diagnoseFail(img, corsCanvas),
      imgSize,
    };
  }

  if (!det) {
    return {
      ok: false,
      error: "no_face_detected",
      errorMessage: "未检测到人脸",
      diagTips: diagnoseFail(img, corsCanvas),
      imgSize,
    };
  }

  const measurements = buildMeasurements(
    det.detection,
    corsCanvas,
    det.procW,
    det.procH,
    det.pass,
  );
  const classification = classifyFace(
    measurements.faceRatio,
    measurements.foreheadRatio,
    measurements.skinTone,
  );

  return {
    ok: true,
    measurements,
    classification,
    archetype: classification.faceType,
  };
}
