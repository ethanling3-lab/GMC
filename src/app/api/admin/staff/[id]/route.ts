import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { STAFF_REGIONS, STAFF_ROLE_VALUES } from "@/lib/staff/roles";
import { createSetupLink, sendSetupEmail } from "@/lib/staff/staff";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/staff/[id]: super admins edit, remove, restore or re-send a link.

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    name_en: z.string().trim().max(120).optional(),
    name_cn: z.string().trim().max(120).optional(),
    role: z.enum(STAFF_ROLE_VALUES),
    region: z.enum(STAFF_REGIONS).nullable().optional(),
  }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("send_link") }),
]);

const LAST_SUPER_DETAIL = "Keep at least one active super admin.";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const body = parsed.data;

  const service = createSupabaseServiceClient();
  const { data: target } = await service
    .from("admins")
    .select("id, name_en, name_cn, role, region, deactivated_at")
    .eq("id", id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const isSelf = target.id === admin.id;

  if (body.action === "update") {
    const name_en = body.name_en ?? "";
    const name_cn = body.name_cn ?? "";
    const region = body.region ?? null;
    if (!name_en && !name_cn) {
      return NextResponse.json({ error: "validation_error", detail: "Enter a name." }, { status: 400 });
    }
    if (isSelf && (body.role !== target.role || region !== target.region)) {
      return NextResponse.json(
        { error: "own_access", detail: "Another super admin must change your own role or region." },
        { status: 409 },
      );
    }
    const { error } = await service
      .from("admins")
      .update({ name_en: name_en || null, name_cn: name_cn || null, role: body.role, region })
      .eq("id", id);
    if (error) {
      const last = error.message.includes("last_super_admin");
      return NextResponse.json(
        { error: last ? "last_super_admin" : "save_failed", detail: last ? LAST_SUPER_DETAIL : error.message },
        { status: last ? 409 : 500 },
      );
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "staff.updated",
      entity: "admin",
      entity_id: id,
      metadata: { from: { role: target.role, region: target.region }, to: { role: body.role, region } },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "remove") {
    if (isSelf) {
      return NextResponse.json(
        { error: "own_access", detail: "You can't remove your own access." },
        { status: 409 },
      );
    }
    const { data, error } = await service.rpc("deactivate_admin", { p_admin_id: id });
    if (error) {
      const last = error.message.includes("last_super_admin");
      const inactive = error.message.includes("admin_not_active");
      return NextResponse.json(
        {
          error: last ? "last_super_admin" : inactive ? "already_removed" : "save_failed",
          detail: last ? LAST_SUPER_DETAIL : inactive ? "This person was already removed." : error.message,
        },
        { status: last || inactive ? 409 : 500 },
      );
    }
    const released = (data as Array<{ participants_released: number; conversations_released: number }>)[0];
    await writeAuditLog({
      actor_id: admin.id,
      action: "staff.removed",
      entity: "admin",
      entity_id: id,
      metadata: { role: target.role, ...released },
    });
    return NextResponse.json({ ok: true, ...released });
  }

  if (body.action === "restore") {
    const { data, error } = await service
      .from("admins")
      .update({ deactivated_at: null })
      .eq("id", id)
      .not("deactivated_at", "is", null)
      .select("id");
    if (error) {
      return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
    }
    if (!data?.length) {
      return NextResponse.json({ error: "already_active", detail: "This person already has access." }, { status: 409 });
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "staff.restored",
      entity: "admin",
      entity_id: id,
      metadata: { role: target.role },
    });
    return NextResponse.json({ ok: true });
  }

  if (target.deactivated_at) {
    return NextResponse.json(
      { error: "removed", detail: "Restore this person before sending a link." },
      { status: 409 },
    );
  }
  const { data: auth } = await service.auth.admin.getUserById(id);
  const email = auth?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "no_email", detail: "This account has no email." }, { status: 409 });
  }
  const link = await createSetupLink(email, "recovery");
  if ("error" in link) {
    return NextResponse.json({ error: "link_failed", detail: link.error }, { status: 500 });
  }
  const email_sent = await sendSetupEmail({
    to: email,
    name: target.name_en || target.name_cn || "there",
    url: link.url,
    type: "recovery",
  });
  await writeAuditLog({
    actor_id: admin.id,
    action: "staff.link_sent",
    entity: "admin",
    entity_id: id,
    metadata: { email_sent },
  });
  return NextResponse.json({ ok: true, setup_url: link.url, email_sent });
}
