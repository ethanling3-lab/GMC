"use client";

import { loadModels, getLoadedFaceApi } from "../face-reading/analyzer.client";
import {
  EMBEDDING_LEN,
  type EmbeddingExtractResult,
  type FaceEmbedding,
} from "./types";

// Client-side face-embedding extractor. Used by:
//   - PhotoUploader (extract on photo upload + ship with the participant
//     PATCH so the embedding lands at the same time as the photo)
//   - The participant detail "Re-compute" button
//   - The /scan station live camera frames
//
// Reuses the same face-api.js instance + cached weights as the existing
// face-reading archetype analyzer (see lib/face-reading/analyzer.client.ts).

// face-api.js's TNet flow: detect → align landmarks → compute 128-d descriptor.
// We use `withFaceLandmarks` to ensure the descriptor is aligned, which
// dramatically improves match quality on tilted / off-axis photos.

async function detectLargest(
  faceapi: NonNullable<ReturnType<typeof getLoadedFaceApi>>,
  source: HTMLImageElement | HTMLVideoElement,
) {
  const options = new faceapi.SsdMobilenetv1Options({
    minConfidence: 0.5,
    maxResults: 4,
  });
  const detections = await faceapi
    .detectAllFaces(source, options)
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (!detections || detections.length === 0) return null;
  // Pick the largest detected face by box area — handles "couple selfie"
  // reference photos where the actual participant is the closer face.
  let best = detections[0];
  let bestArea = best.detection.box.width * best.detection.box.height;
  for (let i = 1; i < detections.length; i += 1) {
    const a = detections[i].detection.box.width * detections[i].detection.box.height;
    if (a > bestArea) {
      best = detections[i];
      bestArea = a;
    }
  }
  return { detection: best, total: detections.length };
}

function descriptorToArray(d: Float32Array): FaceEmbedding {
  // Round to 5 decimal places to keep JSONB rows compact (~3KB per
  // embedding instead of ~8KB) without measurable accuracy loss at the
  // thresholds we care about.
  const out: number[] = new Array(d.length);
  for (let i = 0; i < d.length; i += 1) {
    out[i] = Math.round(d[i] * 1e5) / 1e5;
  }
  return out;
}

export async function extractEmbeddingFromImage(
  imageUrl: string,
): Promise<EmbeddingExtractResult> {
  try {
    await loadModels();
  } catch (err) {
    return {
      ok: false,
      error: "load_failed",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
  const faceapi = getLoadedFaceApi();
  if (!faceapi) {
    return { ok: false, error: "load_failed", detail: "instance_missing" };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(imageUrl);
  } catch (err) {
    return {
      ok: false,
      error: "decode_failed",
      detail: err instanceof Error ? err.message : "fetch_failed",
    };
  }

  const result = await detectLargest(faceapi, img);
  if (!result) return { ok: false, error: "no_face_detected" };
  if (result.total > 4) {
    // Hard cap — if the model finds many faces, the reference photo is
    // probably a group shot. Admin should crop or re-shoot.
    return { ok: false, error: "multiple_faces" };
  }
  const { detection } = result;
  if (detection.detection.score < 0.6) {
    return { ok: false, error: "low_confidence", detail: detection.detection.score.toFixed(3) };
  }
  if (!detection.descriptor || detection.descriptor.length !== EMBEDDING_LEN) {
    return { ok: false, error: "load_failed", detail: "descriptor_shape" };
  }
  return {
    ok: true,
    embedding: descriptorToArray(detection.descriptor),
    confidence: detection.detection.score,
  };
}

export async function extractEmbeddingFromVideo(
  video: HTMLVideoElement,
): Promise<EmbeddingExtractResult> {
  await loadModels();
  const faceapi = getLoadedFaceApi();
  if (!faceapi) {
    return { ok: false, error: "load_failed", detail: "instance_missing" };
  }
  const result = await detectLargest(faceapi, video);
  if (!result) return { ok: false, error: "no_face_detected" };
  const { detection } = result;
  if (!detection.descriptor) return { ok: false, error: "no_face_detected" };
  return {
    ok: true,
    embedding: descriptorToArray(detection.descriptor),
    confidence: detection.detection.score,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}
