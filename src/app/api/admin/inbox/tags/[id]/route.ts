import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { deleteTag, updateTag } from "@/lib/inbox/tags";
import type { TagWriteInput } from "@/lib/inbox/tags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// PATCH /api/admin/inbox/tags/:id — partial update.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can edit tags." },
      { status: 403 },
    );
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", detail: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const { tag, error, notFound } = await updateTag(
    id,
    body as Partial<TagWriteInput>,
    admin,
  );
  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Tag not found or already deleted." },
      { status: 404 },
    );
  }
  if (error) {
    const status = error.field === "slug_conflict" ? 409 : 400;
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status },
    );
  }
  return NextResponse.json({ tag });
}

// DELETE /api/admin/inbox/tags/:id — soft delete.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can delete tags." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const { ok, notFound } = await deleteTag(id, admin);
  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Tag not found or already deleted." },
      { status: 404 },
    );
  }
  if (!ok) {
    return NextResponse.json(
      { error: "delete_failed", detail: "Failed to delete tag." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
