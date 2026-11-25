import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";
import {
  ParticipantUpdateSchema,
  type ParticipantUpdate,
} from "@/lib/participant-update-schema";
import { writeAuditLog } from "@/lib/audit";
import { logParticipantChange } from "@/lib/participants/history";
import { toE164OrNull } from "@/lib/whatsapp/phone";
import { contactLanguageFor } from "@/lib/participants/languages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

// Customer service can edit every profile field on their assigned people,
// except who the person is assigned to and their biometric consent.
const SUPER_ADMIN_ONLY_FIELDS = new Set<string>([
  "assigned_region_lead_id",
  "assigned_cs_id",
  "facial_recognition_consent",
]);

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

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
    if (admin.role !== "customer_service") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    for (const key of Object.keys(patch)) {
      if (SUPER_ADMIN_ONLY_FIELDS.has(key)) {
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
  // `region` comes back too — it supplies the country code when an edited
  // phone has no international prefix (see the phone_e164 block below).
  let scopeCheck = supabase.from("participants").select("id, region").eq("id", id);
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
  const { family_member_ids, conflict_member_ids, suggested_leader_ids, ...columnRest } = patch;
  const columnPatch: Record<string, unknown> = { ...columnRest };

  // The messaging language follows the class languages (migration 074) —
  // staff edit "Listens in" / "Speaks", never language_fluency directly.
  if ("listening_language" in columnPatch || "spoken_languages" in columnPatch) {
    const { data: cur } = await service
      .from("participants")
      .select("listening_language, spoken_languages")
      .eq("id", id)
      .maybeSingle<{ listening_language: string | null; spoken_languages: string[] | null }>();
    const listening =
      "listening_language" in columnPatch
        ? (columnPatch.listening_language as string)
        : cur?.listening_language ?? null;
    const spoken =
      "spoken_languages" in columnPatch
        ? (columnPatch.spoken_languages as string[])
        : cur?.spoken_languages ?? null;
    columnPatch.language_fluency = contactLanguageFor(listening, spoken);
  }

  // Keep phone_e164 in step with phone (migration 052). Editing either the
  // number or the region can change the canonical form — '86111315' is a
  // different number under SG than under HK — so recompute whenever either
  // moves. Null when unnormalisable; the raw edit still saves, and
  // scripts/backfill-phone-e164.ts surfaces the row.
  if ("phone" in columnPatch || "region" in columnPatch) {
    const scopedRow = scoped as { id: string; region: string | null };
    const nextPhone =
      "phone" in columnPatch
        ? (columnPatch.phone as string | null)
        : ((await service
            .from("participants")
            .select("phone")
            .eq("id", id)
            .maybeSingle()).data as { phone: string | null } | null)?.phone ?? null;
    const nextRegion =
      "region" in columnPatch
        ? (columnPatch.region as string | null)
        : scopedRow.region;
    columnPatch.phone_e164 = toE164OrNull(nextPhone, nextRegion);
  }

  // Programme membership (migration 043): when programme_id changes, derive
  // the FROZEN validity window + the legacy programme_tier enum here so the
  // expiry doesn't drift as new payments land. Anchor = explicit admin
  // override else the participant's latest paid enrolment else now.
  if ("programme_id" in columnPatch) {
    const programmeId = columnPatch.programme_id as string | null;
    if (!programmeId) {
      columnPatch.programme_id = null;
      columnPatch.programme_started_at = null;
      columnPatch.programme_expires_at = null;
    } else {
      const { data: prog } = await service
        .from("programmes")
        .select("validity_months")
        .eq("id", programmeId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!prog) {
        return NextResponse.json({ error: "Programme not found" }, { status: 400 });
      }
      const p = prog as { validity_months: number | null };
      let startedAt = (columnPatch.programme_started_at as string | null) ?? null;
      if (!startedAt) {
        const { data: paidRows } = await service
          .from("enrollments")
          .select("paid_at")
          .eq("participant_id", id)
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false })
          .limit(1);
        startedAt =
          (paidRows?.[0]?.paid_at as string | undefined) ?? new Date().toISOString();
      }
      columnPatch.programme_started_at = startedAt;
      columnPatch.programme_expires_at =
        p.validity_months == null ? null : addMonths(startedAt, p.validity_months);
    }
  }

  let data: { id: string; updated_at: string } | null = null;
  if (Object.keys(columnPatch).length > 0) {
    // Read the old values first so the edit history can show what changed.
    const { data: beforeRow, error: beforeErr } = await service
      .from("participants")
      .select(Object.keys(columnPatch).join(", "))
      .eq("id", id)
      .maybeSingle();
    if (beforeErr) {
      return NextResponse.json({ error: beforeErr.message }, { status: 500 });
    }
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
    await logParticipantChange({
      actorId: admin.id,
      participantId: id,
      before: (beforeRow ?? {}) as unknown as Record<string, unknown>,
      after: columnPatch,
    });
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

  // Suggested 组长 (migration 072). Full ordered list in (first =
  // preferred, max 2); replace the stored set. Each pick must be a current
  // group leader (zu_zhang_tier set) and not the participant themselves.
  if (suggested_leader_ids !== undefined) {
    const desired = [...new Set(suggested_leader_ids)].filter((l) => l !== id);
    if (desired.length > 0) {
      const { data: leaders, error: leadErr } = await service
        .from("participants")
        .select("id")
        .in("id", desired)
        .not("zu_zhang_tier", "is", null);
      if (leadErr) {
        return NextResponse.json({ error: leadErr.message }, { status: 500 });
      }
      const ok = new Set((leaders ?? []).map((r) => r.id as string));
      const bad = desired.filter((l) => !ok.has(l));
      if (bad.length > 0) {
        return NextResponse.json(
          { error: "Suggested 组长 must be a group leader in the CRM", detail: bad },
          { status: 400 },
        );
      }
    }

    const { data: currentRows, error: curErr } = await service
      .from("participant_suggested_leaders")
      .select("leader_id, position")
      .eq("participant_id", id)
      .order("position");
    if (curErr) {
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    const current = (currentRows ?? []).map((r) => r.leader_id as string);
    const changed =
      current.length !== desired.length || current.some((l, i) => l !== desired[i]);

    if (changed) {
      const { error: delErr } = await service
        .from("participant_suggested_leaders")
        .delete()
        .eq("participant_id", id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      if (desired.length > 0) {
        const { error: insErr } = await service
          .from("participant_suggested_leaders")
          .insert(
            desired.map((leader_id, i) => ({
              participant_id: id,
              leader_id,
              position: i + 1,
              created_by: admin.id,
            })),
          );
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
      await writeAuditLog({
        actor_id: admin.id,
        action: "participant.suggested_leaders_changed",
        entity: "participants",
        entity_id: id,
        before: { suggested_leader_ids: current },
        after: { suggested_leader_ids: desired },
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
