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
  mode?: "created" | "updated";
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
  // the public registration form; admin-origin inserts/updates need service role.
  const supabase = createSupabaseServiceClient();

  const results: InsertResult[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    const normalizedId = r.region_id?.trim() || null;

    // Fields common to insert + update (exclude non-column fields like `notes`).
    const row = {
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

    if (normalizedId) {
      // Does a participant with this Student ID already exist?
      const { data: existing } = await supabase
        .from("participants")
        .select("id")
        .eq("region_id", normalizedId)
        .maybeSingle();

      if (existing) {
        // UPDATE — merge new info into the existing row
        const { error } = await supabase
          .from("participants")
          .update(row)
          .eq("id", existing.id);
        if (error) {
          results.push({ index: i, ok: false, error: error.message });
        } else {
          results.push({
            index: i,
            ok: true,
            mode: "updated",
            region_id: normalizedId,
          });
        }
        continue;
      }

      // INSERT with this specific Student ID — trigger respects non-null values
      const { data, error } = await supabase
        .from("participants")
        .insert({ ...row, region_id: normalizedId, status: "new" as const })
        .select("region_id")
        .maybeSingle();
      if (error) {
        results.push({ index: i, ok: false, error: error.message });
      } else {
        results.push({
          index: i,
          ok: true,
          mode: "created",
          region_id: data?.region_id ?? normalizedId,
        });
      }
      continue;
    }

    // No Student ID provided — plain insert, trigger auto-assigns
    const { data, error } = await supabase
      .from("participants")
      .insert({ ...row, status: "new" as const })
      .select("region_id")
      .maybeSingle();
    if (error) {
      results.push({ index: i, ok: false, error: error.message });
    } else {
      results.push({
        index: i,
        ok: true,
        mode: "created",
        region_id: data?.region_id ?? null,
      });
    }
  }

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
