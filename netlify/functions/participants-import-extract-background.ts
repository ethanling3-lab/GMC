// Netlify background function. File-name suffix `-background` gives us a
// 15-minute timeout and returns 202 to the caller immediately — which is what
// lets Claude extraction outrun the 26s `___netlify-server-handler` ceiling.
//
// Invoked by /api/admin/participants/import/extract with { jobId }. Reads the
// source payload from import_jobs, calls Claude, writes rows+summary+usage
// back to the same row.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient } from "@supabase/supabase-js";
import {
  ExtractionPayloadSchema,
  EXTRACTION_SYSTEM_PROMPT,
} from "../../src/lib/participant-import-schema";

const MODEL = "claude-haiku-4-5";

type SourcePayload =
  | { kind: "text"; text: string; label: string }
  | { kind: "pdf"; base64: string; filename: string };

type NetlifyEvent = {
  body?: string | null;
  isBase64Encoded?: boolean;
};

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function markError(jobId: string, message: string) {
  await service()
    .from("import_jobs")
    .update({
      status: "error",
      error: message.slice(0, 2000),
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function handler(event: NetlifyEvent) {
  let jobId: string | undefined;

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const parsedBody = JSON.parse(raw || "{}") as { jobId?: string };
    jobId = parsedBody.jobId;
    if (!jobId) return { statusCode: 400 };

    const supabase = service();

    const { data: job, error: loadErr } = await supabase
      .from("import_jobs")
      .select("id, source_payload, status")
      .eq("id", jobId)
      .maybeSingle();

    if (loadErr || !job) {
      return { statusCode: 404 };
    }
    if (job.status !== "pending") {
      // Already picked up by an earlier invocation — don't double-spend Claude.
      return { statusCode: 202 };
    }

    await supabase
      .from("import_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const payload = job.source_payload as SourcePayload;

    let userContent: Anthropic.MessageParam["content"];
    if (payload.kind === "pdf") {
      userContent = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: payload.base64,
          },
        },
        {
          type: "text",
          text: "Extract every participant record from this PDF into the schema. One row per person.",
        },
      ];
    } else {
      userContent = [
        {
          type: "text",
          text: `Source type: ${payload.label}\n\nExtract every participant record into the schema. One row per person.\n\n--- source data ---\n${payload.text}`,
        },
      ];
    }

    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(ExtractionPayloadSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      await markError(
        jobId,
        `Extraction returned no structured data (stop_reason=${response.stop_reason})`,
      );
      return { statusCode: 202 };
    }

    await supabase
      .from("import_jobs")
      .update({
        status: "done",
        rows: parsed.rows,
        summary: parsed.summary,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return { statusCode: 202 };
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Claude API error: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    if (jobId) await markError(jobId, message);
    return { statusCode: 202 };
  }
}
