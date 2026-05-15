// Shared types for the M7.1c face-recognition check-in pipeline.

// face-api.js returns a Float32Array of 128 floats. We serialize as a
// plain number[] when shipping over JSON or storing in JSONB so it's
// portable; the matcher inflates back to a typed array for comparison.
export type FaceEmbedding = number[];

export const EMBEDDING_LEN = 128;

export type EmbeddingExtractError =
  | "no_face_detected"
  | "multiple_faces"
  | "low_confidence"
  | "load_failed"
  | "decode_failed";

export type EmbeddingExtractResult =
  | { ok: true; embedding: FaceEmbedding; confidence: number }
  | { ok: false; error: EmbeddingExtractError; detail?: string };

// A single entry in the per-event embedding bank loaded by the scanner.
// Keeps a thin slice of the participant row — just what the scanner UI
// needs to show the confirmation card.
export type FaceBankEntry = {
  participant_id: string;
  enrollment_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  photo_url: string | null;
  group_no: number | null;
  seat_no: number | null;
  embedding: FaceEmbedding;
};

export type FaceMatch = {
  entry: FaceBankEntry;
  // Cosine similarity in [-1, 1]; 1.0 = identical. Above ~0.5 is a
  // reasonable threshold for face-api.js's recognition net.
  similarity: number;
  // Euclidean distance in face-api.js's descriptor space. Lower is
  // better; face-api.js docs use 0.6 as the canonical match threshold.
  distance: number;
};

// Default thresholds. Tune empirically against the actual photo set —
// surface as URL params on the scanner page until a confident value
// emerges (see Phase 4 in the plan).
export const DEFAULT_DISTANCE_THRESHOLD = 0.55;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.55;
