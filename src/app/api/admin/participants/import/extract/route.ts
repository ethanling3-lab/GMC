import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const MAX_TEXT_CHARS = 250_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function backgroundFunctionUrl(reqUrl: string) {
  // Netlify sets DEPLOY_URL / URL at runtime. In `netlify dev` we fall back to
  // the incoming request origin, which is the local netlify-dev proxy.
  const base =
    process.env.DEPLOY_URL ??
    process.env.URL ??
    new URL(reqUrl).origin;
  return `${base}/.netlify/functions/participants-import-extract-background`;
}

export async function POST(req: Request) {
  const admin = await requireAdmin();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 415 },
    );
  }

  let sourcePayload:
    | { kind: "text"; text: string; label: string }
    | { kind: "pdf"; base64: string; filename: string };
  let sourceLabel: string;

  try {
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
      sourcePayload = {
        kind: "pdf",
        base64: buf.toString("base64"),
        filename: file.name,
      };
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
      sourcePayload = { kind: "text", text, label };
      sourceLabel = label;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: job, error: insertErr } = await supabase
    .from("import_jobs")
    .insert({
      admin_id: admin.id,
      status: "pending",
      source_label: sourceLabel,
      source_payload: sourcePayload,
    })
    .select("id")
    .single();

  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to enqueue job" },
      { status: 500 },
    );
  }

  // Fire-and-forget: the background function returns 202 immediately. We
  // await the fetch only long enough for Netlify to accept the invocation.
  try {
    const res = await fetch(backgroundFunctionUrl(req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    if (!res.ok && res.status !== 202) {
      await supabase
        .from("import_jobs")
        .update({
          status: "error",
          error: `Failed to start background function (HTTP ${res.status})`,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return NextResponse.json(
        { error: `Background function rejected the job (HTTP ${res.status})` },
        { status: 502 },
      );
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach background function";
    await supabase
      .from("import_jobs")
      .update({
        status: "error",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
