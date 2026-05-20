import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { translateText, logAssistRun } from "@/lib/inbox/ai/assist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/inbox/[id]/ai/translate
// Body: { text: string, target?: 'en' | 'zh' }
// Returns { translated: string, target_lang: 'en' | 'zh' }
//
// Target language auto-detected when omitted: text containing CJK → translate
// to English, otherwise to 中文. Admin can override with `target` to force.

const Body = z.object({
  text: z.string().min(1).max(8000),
  target: z.enum(["en", "zh"]).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  await requireAdmin();
  const { id: conversationId } = await params;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json(
      { error: "validation_error", detail: msg },
      { status: 400 },
    );
  }

  const result = await translateText(parsed.text, parsed.target);
  if (!result) {
    return NextResponse.json(
      { error: "unavailable", detail: "Anthropic API key not configured." },
      { status: 503 },
    );
  }

  await logAssistRun({
    conversationId,
    task: "assist_translate",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    result: {
      status: "ok",
      target: result.targetLang,
      input_chars: parsed.text.length,
      output_chars: result.translated.length,
    },
  });

  return NextResponse.json({
    translated: result.translated,
    target_lang: result.targetLang,
  });
}
