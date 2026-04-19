import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

const EventStatusEnum = z.enum(["draft", "open", "closed", "archived"]);

const BulkBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_status"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    status: EventStatusEnum,
  }),
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
]);

export async function POST(req: Request) {
  const admin = await requireAdmin();

  // Both bulk actions are super_admin-only, matching the per-row policy.
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only super admins can run bulk event actions" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof BulkBody>;
  try {
    body = BulkBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  if (body.action === "delete") {
    const { error } = await service
      .from("events")
      .delete()
      .in("id", body.ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await service
      .from("events")
      .update({ status: body.status })
      .in("id", body.ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    action: body.action,
    affected: body.ids.length,
  });
}
