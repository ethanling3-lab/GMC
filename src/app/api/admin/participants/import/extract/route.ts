import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ExtractionPayloadSchema,
  EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/participant-import-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-haiku-4-5";
const MAX_TEXT_CHARS = 250_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  await requireAdmin();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  let userContent: Anthropic.MessageParam["content"] = [];
  let sourceLabel = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const kind = form.get("kind");

      if (kind === "pdf") {
        const file = form.get("file");
        if (!(file instanceof File)) {
          return NextResponse.json(
            { error: "Missing PDF file" },
            { status: 400 },
          );
        }
        if (file.size > MAX_PDF_BYTES) {
          return NextResponse.json(
            { error: `PDF too large (max ${MAX_PDF_BYTES / 1024 / 1024}MB)` },
            { status: 413 },
          );
        }
        const buf = Buffer.from(await file.arrayBuffer());
        userContent = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: buf.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extract every participant record from this PDF into the schema. One row per person.",
          },
        ];
        sourceLabel = `pdf:${file.name}`;
      } else {
        const text = String(form.get("text") ?? "");
        if (!text.trim()) {
          return NextResponse.json(
            { error: "Empty text payload" },
            { status: 400 },
          );
        }
        if (text.length > MAX_TEXT_CHARS) {
          return NextResponse.json(
            {
              error: `Text too large (max ${MAX_TEXT_CHARS.toLocaleString()} chars). Split into smaller imports.`,
            },
            { status: 413 },
          );
        }
        const label = String(form.get("label") ?? "pasted");
        userContent = [
          {
            type: "text",
            text: `Source type: ${label}\n\nExtract every participant record into the schema. One row per person.\n\n--- source data ---\n${text}`,
          },
        ];
        sourceLabel = label;
      }
    } else {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 415 },
      );
    }

    const client = new Anthropic();

    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: zodOutputFormat(ExtractionPayloadSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return NextResponse.json(
        {
          error: "Extraction returned no structured data",
          stop_reason: response.stop_reason,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      rows: parsed.rows,
      summary: parsed.summary,
      source: sourceLabel,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Claude API error: ${err.message}`, status: err.status },
        { status: err.status ?? 500 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
