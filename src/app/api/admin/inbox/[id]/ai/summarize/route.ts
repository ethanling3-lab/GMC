import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import {
  loadAssistContext,
  summarizeThread,
  logAssistRun,
} from "@/lib/inbox/ai/assist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/ai/summarize
// Returns { summary: string } — short English summary of the thread.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteCtx) {
  await requireAdmin();
  const { id: conversationId } = await params;

  const ctx = await loadAssistContext(conversationId);
  if (!ctx) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await summarizeThread(ctx);
  if (!result) {
    return NextResponse.json(
      { error: "unavailable", detail: "Anthropic API key not configured." },
      { status: 503 },
    );
  }

  await logAssistRun({
    conversationId,
    task: "assist_summarize",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    result: { status: "ok", chars: result.summary.length },
  });

  return NextResponse.json({ summary: result.summary });
}
