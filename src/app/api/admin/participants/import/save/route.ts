import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ExtractedRowSchema,
  type ExtractedRow,
} from "@/lib/participant-import-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const SaveBody = z.object({
  rows: z.array(ExtractedRowSchema).min(1).max(500),
});

type InsertResult = {
  index: number;
  ok: boolean;
  mode?: "created" | "updated";
  region_id?: string | null;
  error?: string;
};

type Supa = ReturnType<typeof createSupabaseServiceClient>;

function columnsFrom(r: ExtractedRow) {
  return {
    name_en: r.name_en,
    name_cn: r.name_cn,
    email: r.email,
    phone: r.phone,
    region: r.region,
    language: r.language,
    gender: r.gender,
    birth_date: r.birth_date,
    occupation: r.occupation,
    industry: r.industry,
    motivation_tag: r.motivation_tag,
    is_old_student: r.is_old_student ?? false,
  };
}

async function persistRow(
  supabase: Supa,
  r: ExtractedRow,
  index: number,
): Promise<InsertResult> {
  const normalizedId = r.region_id?.trim() || null;
  const row = columnsFrom(r);

  if (normalizedId) {
    const { data: existing } = await supabase
      .from("participants")
      .select("id")
      .eq("region_id", normalizedId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("participants")
        .update(row)
        .eq("id", existing.id);
      if (error) return { index, ok: false, error: error.message };
      return { index, ok: true, mode: "updated", region_id: normalizedId };
    }

    const { data, error } = await supabase
      .from("participants")
      .insert({ ...row, region_id: normalizedId, status: "new" as const })
      .select("region_id")
      .maybeSingle();
    if (error) return { index, ok: false, error: error.message };
    return {
      index,
      ok: true,
      mode: "created",
      region_id: data?.region_id ?? normalizedId,
    };
  }

  const { data, error } = await supabase
    .from("participants")
    .insert({ ...row, status: "new" as const })
    .select("region_id")
    .maybeSingle();
  if (error) return { index, ok: false, error: error.message };
  return {
    index,
    ok: true,
    mode: "created",
    region_id: data?.region_id ?? null,
  };
}

// Cap concurrency so we don't hammer the Supabase connection pool on large
// imports — 10 in flight is plenty to stay well under the 26s function ceiling
// for 500-row imports while leaving headroom for other traffic.
const CONCURRENCY = 10;

async function runInPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function POST(req: Request) {
  await requireAdmin();

  let body: z.infer<typeof SaveBody>;
  try {
    const raw = await req.json();
    body = SaveBody.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const results = await runInPool(body.rows, (r, i) =>
    persistRow(supabase, r, i),
  );

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const created = results.filter((r) => r.ok && r.mode === "created").length;
  const updated = results.filter((r) => r.ok && r.mode === "updated").length;

  return NextResponse.json({
    total: results.length,
    succeeded,
    failed,
    created,
    updated,
    results,
  });
}
