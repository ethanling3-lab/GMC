import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { removeTagFromConversation } from "@/lib/inbox/tags";
import { validateSlug } from "@/lib/inbox/tags-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// DELETE /api/admin/inbox/:id/tags/:slug — remove a tag from the conversation.
// Idempotent: removing an absent tag returns the existing tag list.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can untag conversations." },
      { status: 403 },
    );
  }

  const { id, slug } = await params;
  const slugErr = validateSlug(slug);
  if (slugErr) {
    return NextResponse.json(
      { error: "invalid_slug", detail: slugErr },
      { status: 400 },
    );
  }

  const { tags, notFound } = await removeTagFromConversation(id, slug, admin);
  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Conversation not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ tags });
}
