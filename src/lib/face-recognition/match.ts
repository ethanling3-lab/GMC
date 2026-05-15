import type { FaceBankEntry, FaceEmbedding, FaceMatch } from "./types";
import { DEFAULT_DISTANCE_THRESHOLD } from "./types";

// Pure matching utilities. Used by the FaceScannerStation client to
// compare a live frame's embedding against the per-event bank loaded at
// page open. Kept dependency-free so we could later port to a worker if
// per-frame cost becomes a bottleneck.

// Euclidean distance in 128-d descriptor space. face-api.js's canonical
// metric — distances below ~0.6 indicate the same identity.
export function euclideanDistance(a: FaceEmbedding, b: FaceEmbedding): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Cosine similarity in [-1, 1]. Less standard for face-api.js but a good
// secondary signal — surfaced on the confirmation card for transparency.
export function cosineSimilarity(a: FaceEmbedding, b: FaceEmbedding): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Best-match scan. Returns the entry with the lowest distance, or null
// if no entry clears the threshold. The threshold defaults to the
// face-api.js canonical 0.55 but the caller can override (URL param,
// admin tuning).
export function findBestMatch(
  query: FaceEmbedding,
  bank: FaceBankEntry[],
  options: { threshold?: number } = {},
): FaceMatch | null {
  const threshold = options.threshold ?? DEFAULT_DISTANCE_THRESHOLD;
  let best: FaceMatch | null = null;
  for (const entry of bank) {
    if (!entry.embedding || entry.embedding.length === 0) continue;
    const distance = euclideanDistance(query, entry.embedding);
    if (distance > threshold) continue;
    if (best === null || distance < best.distance) {
      best = {
        entry,
        distance,
        similarity: cosineSimilarity(query, entry.embedding),
      };
    }
  }
  return best;
}

// Top-N for ambiguous frames where the best match is close to the
// second-best — surfaced in dev tooling so we can spot lookalike pairs
// during smoke testing.
export function topMatches(
  query: FaceEmbedding,
  bank: FaceBankEntry[],
  n = 5,
): FaceMatch[] {
  const scored: FaceMatch[] = bank
    .filter((e) => e.embedding && e.embedding.length > 0)
    .map((entry) => ({
      entry,
      distance: euclideanDistance(query, entry.embedding),
      similarity: cosineSimilarity(query, entry.embedding),
    }));
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, n);
}
