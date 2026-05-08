import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// M6.5b — Claude Opus 4.7 vision-driven table detection over an uploaded
// floor-plan image. Returns normalized (0-1, image-relative) candidate
// boxes; the client owns the letterbox math + spawns shapes via the
// existing persistence beacon.
//
// Coords are NOT in user-space here. Image natural dimensions are tracked
// client-side via an Image() preload; the client converts (x_norm,
// y_norm, width_norm, height_norm) into the canvas's 300x180 user-space
// taking xMidYMid letterbox into account.

export const VISION_MODEL = "claude-opus-4-7";
export const VISION_TASK = "floor_plan_detect_tables";
const MAX_RESPONSE_TOKENS = 4096;

export type DetectedCandidateKind = "round_table" | "square_table";
export type DetectionConfidence = "high" | "medium" | "low";

export type DetectedCandidate = {
  kind: DetectedCandidateKind;
  x_norm: number;
  y_norm: number;
  width_norm: number;
  height_norm: number;
  label: string | null;
  seat_count: number | null;
  confidence: DetectionConfidence | null;
};

export type VisionDetectResult = {
  candidates: DetectedCandidate[];
  notes: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  latency_ms: number;
  failure_reason?: string;
};

const SYSTEM_PROMPT = `You analyze venue floor-plan images for a table-seating event.

Identify ONLY dining tables visible in the image. For each table, return:

- **kind**: "round_table" if the table is circular, "square_table" if rectangular or square.
- **x_norm, y_norm**: the top-left corner of the table's bounding box, expressed as a fraction (0-1) of the image's full width and height.
- **width_norm, height_norm**: the bounding-box size as a fraction of the image's width and height.
- **label**: the printed table number or name if visible (e.g. "1", "12", "Head Table"). Omit if no clear label.
- **seat_count**: approximate number of seats around the table if visible. Omit if unclear.
- **confidence**: "high" if the table is clearly drawn with chairs around it; "medium" if it's a labeled rectangle/circle without explicit chairs; "low" for ambiguous shapes.

IGNORE the following — they are NOT dining tables:
- Stages, platforms, podiums, lecterns
- Doors, walls, windows, columns
- AV consoles, registration desks, ticket booths
- Buffet tables, food service stations
- Decorative elements, plants, signage
- Bathrooms, hallways, back-of-house areas

Return all detected tables in a single propose_tables tool call. If the image
contains no dining tables, return an empty tables array. Be precise — over-
inclusion forces admins to manually reject every false positive.`;

const PROPOSE_TABLES_TOOL: Anthropic.Tool = {
  name: "propose_tables",
  description: "Propose dining tables visible in the floor plan image",
  input_schema: {
    type: "object",
    properties: {
      tables: {
        type: "array",
        description: "All detected dining tables",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["round_table", "square_table"],
            },
            x_norm: {
              type: "number",
              description: "Top-left X as a fraction (0-1) of image width",
            },
            y_norm: {
              type: "number",
              description: "Top-left Y as a fraction (0-1) of image height",
            },
            width_norm: {
              type: "number",
              description: "Width as a fraction (0-1) of image width",
            },
            height_norm: {
              type: "number",
              description: "Height as a fraction (0-1) of image height",
            },
            label: {
              type: "string",
              description: "Printed table number or name, if visible",
            },
            seat_count: {
              type: "integer",
              description: "Approximate seat count if visible",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
          },
          required: ["kind", "x_norm", "y_norm", "width_norm", "height_norm"],
        },
      },
      notes: {
        type: "string",
        description:
          "Optional notes about the floor plan (scale uncertainty, occluded areas, etc.)",
      },
    },
    required: ["tables"],
  },
};

const empty: VisionDetectResult = {
  candidates: [],
  notes: null,
  tokens_in: 0,
  tokens_out: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  latency_ms: 0,
};

export async function detectTablesInFloorPlan(
  imageBuffer: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
): Promise<VisionDetectResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ...empty, failure_reason: "anthropic_api_key_missing" };
  }
  const client = new Anthropic({ apiKey });

  const startedAt = Date.now();
  const base64 = imageBuffer.toString("base64");

  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_RESPONSE_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [PROPOSE_TABLES_TOOL],
      tool_choice: { type: "tool", name: "propose_tables" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64,
              },
            },
            {
              type: "text",
              text: "Detect all dining tables in this floor plan.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ...empty,
      latency_ms: Date.now() - startedAt,
      failure_reason: `anthropic_call_failed:${reason}`,
    };
  }

  const usage = resp.usage;
  const tokensIn = usage.input_tokens;
  const tokensOut = usage.output_tokens;
  const cacheReads = usage.cache_read_input_tokens ?? 0;
  const cacheCreates = usage.cache_creation_input_tokens ?? 0;

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "propose_tables",
  );
  if (!toolUse) {
    return {
      ...empty,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cache_read_tokens: cacheReads,
      cache_creation_tokens: cacheCreates,
      latency_ms: Date.now() - startedAt,
      failure_reason: "no_tool_use",
    };
  }

  const candidates = parseCandidates(toolUse.input);
  const notes =
    typeof (toolUse.input as { notes?: unknown }).notes === "string"
      ? (toolUse.input as { notes: string }).notes
      : null;

  return {
    candidates,
    notes,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cache_read_tokens: cacheReads,
    cache_creation_tokens: cacheCreates,
    latency_ms: Date.now() - startedAt,
  };
}

function parseCandidates(input: unknown): DetectedCandidate[] {
  if (!input || typeof input !== "object") return [];
  const tables = (input as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  const out: DetectedCandidate[] = [];
  for (const t of tables) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "round_table" && kind !== "square_table") continue;
    const x = numOrNull(r.x_norm);
    const y = numOrNull(r.y_norm);
    const w = numOrNull(r.width_norm);
    const h = numOrNull(r.height_norm);
    if (x === null || y === null || w === null || h === null) continue;
    if (!finiteIn01(x) || !finiteIn01(y)) continue;
    if (!finiteIn01(w) || !finiteIn01(h)) continue;
    if (w <= 0 || h <= 0) continue;
    const label = typeof r.label === "string" && r.label.trim().length > 0
      ? r.label.trim().slice(0, 24)
      : null;
    const seatCount =
      typeof r.seat_count === "number" && Number.isFinite(r.seat_count)
        ? Math.max(1, Math.min(40, Math.round(r.seat_count)))
        : null;
    const confidence =
      r.confidence === "high"
        || r.confidence === "medium"
        || r.confidence === "low"
        ? (r.confidence as DetectionConfidence)
        : null;
    out.push({
      kind,
      x_norm: x,
      y_norm: y,
      width_norm: w,
      height_norm: h,
      label,
      seat_count: seatCount,
      confidence,
    });
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function finiteIn01(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 1.5;
  // Allow up to 1.5 to tolerate the model occasionally drifting past 1; the
  // client clamps when mapping to user-space.
}
