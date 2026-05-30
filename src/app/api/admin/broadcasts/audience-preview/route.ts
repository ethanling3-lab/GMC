import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { resolveAudience } from "@/lib/broadcasts/audience";
import { AudiencePreviewBodyZ } from "@/lib/broadcasts/api-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/broadcasts/audience-preview — composer-time live
// preview before a broadcast row exists. Body: full audience filter +
// channels. Returns the first 20 recipients (region_id + name only)
// for the preview list, plus matched/reachable/excluded counts.
//
// Privacy note: per the project's [[privacy]] rule, external/AI-facing
// content uses region_id only. This route is admin-only (rls-by-route)
// so returning name_cn / name_en alongside region_id is fine — this is
// internal triage UX, not external output.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: ReturnType<typeof AudiencePreviewBodyZ.parse>;
  try {
    body = AudiencePreviewBodyZ.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "validation_error", detail: err instanceof Error ? err.message : "Invalid" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const resolution = await resolveAudience(service, admin, body.audience_filter, body.channels);

  const preview = resolution.recipients.slice(0, 20).map((r) => ({
    participant_id: r.participant_id,
    region_id: r.region_id,
    name_cn: r.name_cn,
    name_en: r.name_en,
    channels: Object.entries(r.addresses)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k),
  }));

  return NextResponse.json({
    matched: resolution.total_matched,
    reachable: resolution.recipients.length,
    excluded_no_address: resolution.excluded_no_address,
    excluded_out_of_region: resolution.excluded_out_of_region,
    preview,
  });
}
