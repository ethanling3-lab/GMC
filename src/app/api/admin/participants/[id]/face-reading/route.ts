import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";
import {
  ARCHETYPE_NAMES,
  SKIN_TONES,
  classifyFace,
  type ArchetypeName,
  type FaceMeasurements,
  type SkinTone,
} from "@/lib/face-reading/archetypes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

const MeasurementsSchema = z
  .object({
    faceRatio: z.number().finite(),
    foreheadRatio: z.number().finite(),
    faceWidth: z.number().finite(),
    faceHeight: z.number().finite(),
    foreheadH: z.number().finite(),
    lowerFaceH: z.number().finite(),
    skinTone: z.enum(SKIN_TONES),
    skinRGB: z
      .object({
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
      })
      .nullable(),
    skinCORS: z.boolean(),
    isNarrow: z.boolean(),
    isHighForehead: z.boolean(),
    detPass: z.string().nullable(),
    corsLimited: z.boolean(),
  })
  .strict();

const SaveOk = z.object({
  ok: z.literal(true),
  measurements: MeasurementsSchema,
  classification: z.object({
    faceType: z.string(),
    widthLabel: z.string(),
    foreheadLabel: z.string(),
    widthType: z.enum(["宽", "窄"]),
    foreheadType: z.enum(["高", "低"]),
    isNarrow: z.boolean(),
    isHighForehead: z.boolean(),
  }),
  archetype: z.string(),
});

const SaveFail = z.object({
  ok: z.literal(false),
  error: z.enum(["image_load_failed", "no_face_detected", "analysis_failed"]),
  errorMessage: z.string().max(500),
  diagTips: z.array(z.string().max(300)).max(20),
  imgSize: z.string().max(50).nullable(),
});

const PostBody = z.discriminatedUnion("ok", [SaveOk, SaveFail]);

const PatchBody = z
  .object({
    face_archetype: z
      .union([z.enum(ARCHETYPE_NAMES), z.null()])
      .optional(),
    face_skin_tone_override: z
      .union([z.enum(SKIN_TONES), z.null()])
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      "face_archetype" in v || "face_skin_tone_override" in v,
    { message: "No fields to update" },
  );

async function scopedFetch(
  id: string,
  admin: { role: string; id: string; region: string | null },
) {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("participants")
    .select("id, face_measurements, face_archetype_suggested")
    .eq("id", id);
  q = applyRoleScope(q, admin.role, admin.id, admin.region);
  return q.maybeSingle();
}

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { data: scoped, error: scopeErr } = await scopedFetch(id, admin);
  if (scopeErr || !scoped) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createSupabaseServiceClient();

  if (body.ok === false) {
    // Failed analysis — record error code + tips, clear stale measurements
    // so the card knows the latest run did not produce a result.
    const update = {
      face_archetype_suggested: null,
      face_measurements: { error: body.error, diagTips: body.diagTips, imgSize: body.imgSize },
      face_analyzed_at: new Date().toISOString(),
      face_analysis_error: body.error,
    };
    const { error } = await service
      .from("participants")
      .update(update)
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, kind: "failure" });
  }

  // Success: trust the client's archetype only if it's one of the 10 names.
  const archetype = (ARCHETYPE_NAMES as readonly string[]).includes(
    body.archetype,
  )
    ? (body.archetype as ArchetypeName)
    : null;

  // Existing admin override (if any) wins over a fresh suggestion.
  const existingArchetype = (
    scoped as { face_archetype_suggested: string | null } & {
      face_archetype?: string | null;
    }
  ).face_archetype_suggested;

  const update: Record<string, unknown> = {
    face_archetype_suggested: archetype,
    face_measurements: body.measurements,
    face_analyzed_at: new Date().toISOString(),
    face_analysis_error: null,
  };
  // If the participant has no confirmed archetype yet (first run, or
  // suggestion changed and admin hadn't picked one), accept the
  // suggestion as the confirmed value.
  if (!existingArchetype) {
    update.face_archetype = archetype;
  }

  const { error } = await service
    .from("participants")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, kind: "success", archetype });
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { data: scoped, error: scopeErr } = await scopedFetch(id, admin);
  if (scopeErr || !scoped) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createSupabaseServiceClient();
  const update: Record<string, unknown> = {};

  if ("face_archetype" in body) {
    update.face_archetype = body.face_archetype ?? null;
  }

  if ("face_skin_tone_override" in body) {
    const override = body.face_skin_tone_override ?? null;
    update.face_skin_tone_override = override;

    // Recompute archetype against existing measurements using the
    // override (or the algorithm's measured tone if the override was
    // cleared). Only when the admin hasn't separately pinned an
    // archetype in the same patch.
    if (!("face_archetype" in body)) {
      const measurements = (scoped as {
        face_measurements: FaceMeasurements | null;
      }).face_measurements;
      if (
        measurements &&
        typeof measurements.faceRatio === "number" &&
        typeof measurements.foreheadRatio === "number"
      ) {
        const tone: SkinTone =
          override ??
          (measurements.skinTone &&
          (SKIN_TONES as readonly string[]).includes(measurements.skinTone)
            ? (measurements.skinTone as SkinTone)
            : "黄");
        const cls = classifyFace(
          measurements.faceRatio,
          measurements.foreheadRatio,
          tone,
        );
        const next = (ARCHETYPE_NAMES as readonly string[]).includes(cls.faceType)
          ? (cls.faceType as ArchetypeName)
          : null;
        update.face_archetype = next;
      }
    }
  }

  const { error } = await service
    .from("participants")
    .update(update)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
