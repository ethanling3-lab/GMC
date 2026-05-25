import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { applyTagToConversation } from "@/lib/inbox/tags";
import { validateSlug } from "@/lib/inbox/tags-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// POST /api/admin/inbox/:id/tags — apply a tag (by slug) to the conversation.
// Idempotent: applying an already-present tag returns the existing tag list.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can tag conversations." },
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

  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== "string") {
    return NextResponse.json(
      { error: "invalid_input", detail: "Body must include a string `slug`." },
      { status: 400 },
    );
  }
  const slugErr = validateSlug(slug);
  if (slugErr) {
    return NextResponse.json(
      { error: "invalid_slug", detail: slugErr },
      { status: 400 },
    );
  }

  const { tags, notFound } = await applyTagToConversation(id, slug, admin);
  if (notFound) {
    return NextResponse.json(
      { error: "not_found", detail: "Conversation not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ tags });
}
