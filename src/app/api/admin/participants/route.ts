import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  ParticipantUpdateSchema,
  SCOPED_ALLOWED_FIELDS,
  type ParticipantUpdate,
} from "@/lib/participant-update-schema";
import { REGIONS } from "@/lib/participant-import-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const BUCKET = "participant-photos";

const CreateJsonSchema = ParticipantUpdateSchema;

function atLeastOneName(data: ParticipantUpdate): boolean {
  return Boolean(
    (data.name_en && data.name_en.trim()) ||
      (data.name_cn && data.name_cn.trim()),
  );
}

export async function POST(req: Request) {
  const admin = await requireAdmin();

  const contentType = req.headers.get("content-type") ?? "";
  let fields: ParticipantUpdate;
  let photo: File | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fieldsJson = String(form.get("fields") ?? "{}");
      const raw = JSON.parse(fieldsJson);
      fields = CreateJsonSchema.parse(raw);
      const file = form.get("photo");
      if (file instanceof File && file.size > 0) photo = file;
    } else {
      const raw = await req.json();
      fields = CreateJsonSchema.parse(raw);
    }
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!atLeastOneName(fields)) {
    return NextResponse.json(
      { error: "At least one of name_en or name_cn is required." },
      { status: 400 },
    );
  }

  // Regional leads can only create participants in their region; CS cannot create directly.
  if (admin.role === "customer_service") {
    return NextResponse.json(
      { error: "Customer service cannot create participants directly." },
      { status: 403 },
    );
  }
  if (admin.role === "regional_lead") {
    if (!admin.region || !(REGIONS as readonly string[]).includes(admin.region)) {
      return NextResponse.json(
        { error: "Regional lead has no valid region configured." },
        { status: 403 },
      );
    }
    const adminRegion = admin.region as (typeof REGIONS)[number];
    if (!fields.region) fields.region = adminRegion;
    if (fields.region !== adminRegion) {
      return NextResponse.json(
        { error: `Region must be ${adminRegion} for your role.` },
        { status: 403 },
      );
    }
    // Strip fields regional leads cannot set
    const allowed = new Set<string>([...SCOPED_ALLOWED_FIELDS, "region"]);
    for (const k of Object.keys(fields)) {
      if (!allowed.has(k)) {
        delete (fields as Record<string, unknown>)[k];
      }
    }
  }

  // Validate photo before inserting the row
  if (photo) {
    if (!ALLOWED_PHOTO_TYPES.has(photo.type)) {
      return NextResponse.json(
        {
          error: `Unsupported image type (${photo.type || "unknown"}). Use JPEG, PNG, WebP, or HEIC.`,
        },
        { status: 415 },
      );
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `Image is larger than ${MAX_PHOTO_BYTES / 1024 / 1024}MB.` },
        { status: 413 },
      );
    }
  }

  const supabase = await createSupabaseServerClient();

  const { data: created, error: insertErr } = await supabase
    .from("participants")
    .insert({ ...fields, status: fields.status ?? "new" })
    .select("id, region_id")
    .maybeSingle();

  if (insertErr || !created) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  let photoUrl: string | null = null;
  if (photo) {
    const ext =
      (photo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") ||
      "jpg";
    const path = `${created.id}/${Date.now()}.${ext}`;
    const service = createSupabaseServiceClient();
    const buf = Buffer.from(await photo.arrayBuffer());

    const { error: uploadErr } = await service.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: photo.type, upsert: false });

    if (uploadErr) {
      // Participant is created but photo failed — surface a warning, not a failure
      return NextResponse.json({
        ok: true,
        id: created.id,
        region_id: created.region_id,
        front_photo_url: null,
        photo_warning: `Photo upload failed: ${uploadErr.message}. Upload it from the detail page.`,
      });
    }

    const { data: publicData } = service.storage.from(BUCKET).getPublicUrl(path);
    photoUrl = publicData?.publicUrl ?? null;

    await supabase
      .from("participants")
      .update({ front_photo_url: photoUrl })
      .eq("id", created.id);
  }

  return NextResponse.json({
    ok: true,
    id: created.id,
    region_id: created.region_id,
    front_photo_url: photoUrl,
  });
}
