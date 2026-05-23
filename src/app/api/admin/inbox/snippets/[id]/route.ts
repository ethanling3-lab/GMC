import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { deleteSnippet, updateSnippet } from "@/lib/inbox/snippets";
import type { SnippetWriteInput } from "@/lib/inbox/snippets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// PATCH /api/admin/inbox/snippets/:id — partial update.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can edit snippets." },
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

  const { snippet, error, notFound } = await updateSnippet(
    id,
    body as Partial<SnippetWriteInput>,
    admin,
  );

  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Snippet not found or already deleted." },
      { status: 404 },
    );
  }
  if (error) {
    const status = error.field === "shortcut_conflict" ? 409 : 400;
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status },
    );
  }

  return NextResponse.json({ snippet });
}

// DELETE /api/admin/inbox/snippets/:id — soft delete.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can delete snippets." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const { ok, notFound } = await deleteSnippet(id, admin);
  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Snippet not found or already deleted." },
      { status: 404 },
    );
  }
  if (!ok) {
    return NextResponse.json(
      { error: "delete_failed", detail: "Failed to delete snippet." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
