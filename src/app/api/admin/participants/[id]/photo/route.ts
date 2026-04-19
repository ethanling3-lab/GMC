import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { applyRoleScope } from "@/lib/participants-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const BUCKET = "participant-photos";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  // Scoped check
  let scopeCheck = supabase.from("participants").select("id, region_id").eq("id", id);
  scopeCheck = applyRoleScope(scopeCheck, admin.role, admin.id, admin.region);
  const { data: scoped, error: scopeErr } = await scopeCheck.maybeSingle();
  if (scopeErr || !scoped) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const action = String(form.get("action") ?? "upload");

  if (action === "remove") {
    const { error } = await supabase
      .from("participants")
      .update({ front_photo_url: null })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, url: null });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported image type (${file.type || "unknown"}). Use JPEG, PNG, WebP, or HEIC.`,
      },
      { status: 415 },
    );
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `Image is larger than ${MAX_PHOTO_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${id}/${Date.now()}.${ext}`;

  const service = createSupabaseServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      {
        error: `Upload failed: ${uploadErr.message}. Confirm the "${BUCKET}" bucket exists in Supabase.`,
      },
      { status: 500 },
    );
  }

  const { data: publicData } = service.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = publicData?.publicUrl ?? null;

  const { error: updateErr } = await supabase
    .from("participants")
    .update({ front_photo_url: publicUrl })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: publicUrl });
}
