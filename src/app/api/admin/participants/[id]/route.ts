import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";
import {
  ParticipantUpdateSchema,
  SCOPED_ALLOWED_FIELDS,
  type ParticipantUpdate,
} from "@/lib/participant-update-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  let patch: ParticipantUpdate;
  try {
    const raw = await req.json();
    patch = ParticipantUpdateSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Restrict fields for non-super-admin roles
  if (admin.role !== "super_admin") {
    const allowed = new Set<string>(SCOPED_ALLOWED_FIELDS);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        return NextResponse.json(
          {
            error: `Field not editable by your role: ${key}`,
          },
          { status: 403 },
        );
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Scoped read first — confirms the admin can see this participant.
  let scopeCheck = supabase.from("participants").select("id").eq("id", id);
  scopeCheck = applyRoleScope(scopeCheck, admin.role, admin.id, admin.region);
  const { data: scoped, error: scopeErr } = await scopeCheck.maybeSingle();
  if (scopeErr || !scoped) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("participants")
    .update(patch)
    .eq("id", id)
    .select("id, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id, updated_at: data?.updated_at });
}
