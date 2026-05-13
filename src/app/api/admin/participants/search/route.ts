import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";

export const dynamic = "force-dynamic";

// Lightweight typeahead lookup for the manual-enrol picker. Mirrors the
// search behaviour used by the enrolments console (name_en/name_cn/region_id/
// email/phone) and respects the same role-scope rules. Returns at most 12
// rows so the UI can render a flat list without scrolling.

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (
    admin.role !== "super_admin" &&
    admin.role !== "regional_lead" &&
    admin.role !== "customer_service"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ rows: [] });
  }
  // Allow callers (e.g. the lead-merge picker) to hide leads from results
  // without having to filter client-side over a possibly-capped page.
  const excludeStatus = url.searchParams.get("exclude_status")?.trim() ?? "";

  const supabase = await createSupabaseServerClient();
  const needle = `%${q.replace(/[%_]/g, "\\$&")}%`;

  let query = supabase
    .from("participants")
    .select("id, region_id, name_en, name_cn, region, email, phone, language_fluency, is_old_student")
    .or(
      [
        `name_en.ilike.${needle}`,
        `name_cn.ilike.${needle}`,
        `region_id.ilike.${needle}`,
        `email.ilike.${needle}`,
        `phone.ilike.${needle}`,
      ].join(","),
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (excludeStatus) {
    query = query.neq("status", excludeStatus);
  }
  query = applyRoleScope(query, admin.role, admin.id, admin.region);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
