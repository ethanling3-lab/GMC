import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { ExtractedRowSchema } from "@/lib/participant-import-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SaveBody = z.object({
  rows: z.array(ExtractedRowSchema).min(1).max(500),
});

type InsertResult = {
  index: number;
  ok: boolean;
  region_id?: string | null;
  error?: string;
};

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

  // Service-role client bypasses RLS — participants INSERT is restricted to
  // the public registration form; admin-origin inserts need service role.
  const supabase = createSupabaseServiceClient();

  const results: InsertResult[] = [];
  const toInsert = body.rows.map((r) => ({
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
    status: "new" as const,
  }));

  // Insert one row at a time so we can surface per-row errors and per-row region_id.
  // The schema caps this at 500 rows, and region_id is assigned by a Postgres trigger.
  for (let i = 0; i < toInsert.length; i++) {
    const row = toInsert[i];
    const { data, error } = await supabase
      .from("participants")
      .insert(row)
      .select("region_id")
      .maybeSingle();

    if (error) {
      results.push({ index: i, ok: false, error: error.message });
    } else {
      results.push({
        index: i,
        ok: true,
        region_id: data?.region_id ?? null,
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    total: results.length,
    succeeded,
    failed,
    results,
  });
}
