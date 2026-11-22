import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { STAFF_REGIONS, STAFF_ROLE_VALUES } from "@/lib/staff/roles";
import {
  createSetupLink,
  findAuthUserByEmail,
  sendAccessEmail,
  sendSetupEmail,
} from "@/lib/staff/staff";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/staff: super admins invite a staff member.

const Body = z
  .object({
    name_en: z.string().trim().max(120).optional(),
    name_cn: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(STAFF_ROLE_VALUES),
    region: z.enum(STAFF_REGIONS).nullable().optional(),
  })
  .refine((b) => Boolean(b.name_en || b.name_cn), {
    message: "Enter a name.",
    path: ["name_en"],
  })
  .refine((b) => b.role !== "regional_lead" || Boolean(b.region), {
    message: "Choose a region for a regional lead.",
    path: ["region"],
  });

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", detail: parsed.error.issues[0]?.message ?? "Check the form." },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const name = body.name_en || body.name_cn || "";
  const row = {
    name_en: body.name_en || null,
    name_cn: body.name_cn || null,
    role: body.role,
    region: body.region ?? null,
  };

  const service = createSupabaseServiceClient();
  const existing = await findAuthUserByEmail(body.email);

  if (existing) {
    const { data: current } = await service
      .from("admins")
      .select("id, deactivated_at")
      .eq("id", existing.id)
      .maybeSingle();
    if (current) {
      return NextResponse.json(
        {
          error: "already_staff",
          detail: current.deactivated_at
            ? "This person was removed. Find them in the list and click Restore."
            : "This email is already on the staff list.",
        },
        { status: 409 },
      );
    }

    const { error } = await service.from("admins").insert({ id: existing.id, ...row });
    if (error) {
      return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
    }

    let setup_url: string | null = null;
    let email_sent: boolean;
    if (existing.last_sign_in_at) {
      email_sent = await sendAccessEmail({ to: body.email, name });
    } else {
      const link = await createSetupLink(body.email, "recovery");
      if ("error" in link) {
        email_sent = false;
      } else {
        setup_url = link.url;
        email_sent = await sendSetupEmail({ to: body.email, name, url: link.url, type: "recovery" });
      }
    }
    await writeAuditLog({
      actor_id: admin.id,
      action: "staff.invited",
      entity: "admin",
      entity_id: existing.id,
      metadata: { role: row.role, region: row.region, existing_account: true, email_sent },
    });
    return NextResponse.json({
      ok: true,
      existing_account: Boolean(existing.last_sign_in_at),
      setup_url,
      email_sent,
    });
  }

  const link = await createSetupLink(body.email, "invite");
  if ("error" in link) {
    return NextResponse.json({ error: "invite_failed", detail: link.error }, { status: 500 });
  }
  const { error } = await service.from("admins").insert({ id: link.userId, ...row });
  if (error) {
    await service.auth.admin.deleteUser(link.userId);
    return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
  }

  const email_sent = await sendSetupEmail({ to: body.email, name, url: link.url, type: "invite" });
  await writeAuditLog({
    actor_id: admin.id,
    action: "staff.invited",
    entity: "admin",
    entity_id: link.userId,
    metadata: { role: row.role, region: row.region, existing_account: false, email_sent },
  });
  return NextResponse.json({ ok: true, existing_account: false, setup_url: link.url, email_sent });
}
