import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadAssistContext,
  streamDraft,
  logAssistRun,
} from "@/lib/inbox/ai/assist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/ai/draft
// Returns text/plain streaming chunks of a suggested reply.
// Admin reviews the streamed draft and clicks "Insert" to push it into the
// composer textarea. Nothing is sent until the admin hits Send.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  await requireAdmin();
  const { id: conversationId } = await params;

  const ctx = await loadAssistContext(conversationId);
  if (!ctx) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const stream = streamDraft(ctx);
  if (!stream) {
    return NextResponse.json(
      {
        error: "unavailable",
        detail:
          ctx.messages.length === 0
            ? "Thread has no messages to draft from."
            : "Anthropic API key not configured.",
      },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          controller.enqueue(encoder.encode(chunk));
        }
        const meta = await stream.finalize();
        await logAssistRun({
          conversationId,
          task: "assist_draft",
          tokensIn: meta.tokensIn,
          tokensOut: meta.tokensOut,
          latencyMs: meta.latencyMs,
          result: { status: "ok" },
        });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n[error: ${message}]`));
        await logAssistRun({
          conversationId,
          task: "assist_draft",
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          result: { status: "error", error: message },
        });
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
