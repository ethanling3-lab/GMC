import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";
import {
  ParticipantUpdateSchema,
  SCOPED_ALLOWED_FIELDS,
  type ParticipantUpdate,
} from "@/lib/participant-update-schema";
import { writeAuditLog } from "@/lib/audit";

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

  // PATCH runs through the service client — the scope check above is the
  // auth gate, and service role sidesteps any RLS constraints on updates.
  const service = createSupabaseServiceClient();

  // Pull join-table fields out of the column-level patch — they're
  // reconciled against their respective adjacency tables below, not
  // stored as columns. Everything else flows straight to UPDATE.
  const { family_member_ids, conflict_member_ids, ...columnPatch } = patch;

  let data: { id: string; updated_at: string } | null = null;
  if (Object.keys(columnPatch).length > 0) {
    const res = await service
      .from("participants")
      .update(columnPatch)
      .eq("id", id)
      .select("id, updated_at")
      .maybeSingle();
    if (res.error) {
      const error = res.error;
      if (
        error.code === "23505" ||
        error.message.includes("participants_region_id_key") ||
        /duplicate key value.*region_id/i.test(error.message)
      ) {
        return NextResponse.json(
          {
            error:
              "That Student ID is already in use. Pick a different one or leave it blank to keep the current ID.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    data = res.data as { id: string; updated_at: string } | null;
  }

  // Family-link reconciliation. The client sends the FULL desired set
  // of partner IDs; we diff against the current set and apply the
  // delta. Edges are stored canonically (a_id < b_id).
  if (family_member_ids !== undefined) {
    const desiredOthers = new Set(
      family_member_ids.filter((other) => other !== id),
    );

    const { data: currentRows, error: curErr } = await service
      .from("participant_family_links")
      .select("a_id, b_id")
      .or(`a_id.eq.${id},b_id.eq.${id}`);
    if (curErr) {
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    const currentOthers = new Set(
      (currentRows ?? []).map((r) =>
        r.a_id === id ? r.b_id : r.a_id,
      ),
    );

    const toAdd = [...desiredOthers].filter((o) => !currentOthers.has(o));
    const toRemove = [...currentOthers].filter((o) => !desiredOthers.has(o));

    if (toAdd.length > 0) {
      const newRows = toAdd.map((other) => {
        const a_id = id < other ? id : other;
        const b_id = id < other ? other : id;
        return { a_id, b_id, created_by: admin.id };
      });
      const { error: insErr } = await service
        .from("participant_family_links")
        .insert(newRows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    for (const other of toRemove) {
      const a_id = id < other ? id : other;
      const b_id = id < other ? other : id;
      const { error: delErr } = await service
        .from("participant_family_links")
        .delete()
        .eq("a_id", a_id)
        .eq("b_id", b_id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await writeAuditLog({
        actor_id: admin.id,
        action: "participant.family_links_changed",
        entity: "participants",
        entity_id: id,
        before: { family_member_ids: [...currentOthers] },
        after: { family_member_ids: [...desiredOthers] },
        metadata: { added: toAdd, removed: toRemove },
      });
    }
  }

  // Conflict-pair reconciliation. Same shape as family-link block above
  // — full desired set in, diff against current, apply the delta.
  if (conflict_member_ids !== undefined) {
    const desiredOthers = new Set(
      conflict_member_ids.filter((other) => other !== id),
    );

    const { data: currentRows, error: curErr } = await service
      .from("participant_conflict_pairs")
      .select("a_id, b_id")
      .or(`a_id.eq.${id},b_id.eq.${id}`);
    if (curErr) {
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    const currentOthers = new Set(
      (currentRows ?? []).map((r) => (r.a_id === id ? r.b_id : r.a_id)),
    );

    const toAdd = [...desiredOthers].filter((o) => !currentOthers.has(o));
    const toRemove = [...currentOthers].filter((o) => !desiredOthers.has(o));

    if (toAdd.length > 0) {
      const newRows = toAdd.map((other) => {
        const a_id = id < other ? id : other;
        const b_id = id < other ? other : id;
        return { a_id, b_id, created_by: admin.id };
      });
      const { error: insErr } = await service
        .from("participant_conflict_pairs")
        .insert(newRows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    for (const other of toRemove) {
      const a_id = id < other ? id : other;
      const b_id = id < other ? other : id;
      const { error: delErr } = await service
        .from("participant_conflict_pairs")
        .delete()
        .eq("a_id", a_id)
        .eq("b_id", b_id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await writeAuditLog({
        actor_id: admin.id,
        action: "participant.conflict_pairs_changed",
        entity: "participants",
        entity_id: id,
        before: { conflict_member_ids: [...currentOthers] },
        after: { conflict_member_ids: [...desiredOthers] },
        metadata: { added: toAdd, removed: toRemove },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    id: data?.id ?? id,
    updated_at: data?.updated_at,
  });
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  // Hard delete is super_admin only — anyone else should archive instead.
  if (admin.role !== "super_admin") {
    return NextResponse.json(
      {
        error:
          "Only super admins can permanently delete a participant. Archive it instead.",
      },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();
  const { error } = await service.from("participants").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
