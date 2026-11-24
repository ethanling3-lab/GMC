import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// GET /api/admin/participants/leaders/search?q=
//
// Typeahead for "Suggested 组长 · 建议在谁的小组". Searches ONLY people who
// are group leaders (zu_zhang_tier set), across the whole CRM — CS can't
// find leaders through the normal search, which is scoped to their own
// assigned customers.
//
// Deliberately returns a fixed, minimal field set (no email/phone/scores):
// limited roles read through role-checked server code with fixed fields,
// because RLS can't hide columns.

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "customer_service") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ rows: [] });
  }
  const needle = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("participants")
    .select("id, region_id, name_en, name_cn, zu_zhang_tier, zu_zhang_dimensions")
    .not("zu_zhang_tier", "is", null)
    .is("archived_at", null)
    .or(
      [
        `name_en.ilike.${needle}`,
        `name_cn.ilike.${needle}`,
        `region_id.ilike.${needle}`,
      ].join(","),
    )
    .order("name_cn", { ascending: true })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
