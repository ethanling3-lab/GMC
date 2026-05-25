import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createTag, listTags } from "@/lib/inbox/tags";
import type { TagWriteInput } from "@/lib/inbox/tags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// GET /api/admin/inbox/tags — list active tag definitions.
export async function GET() {
  await requireAdmin();
  const tags = await listTags();
  return NextResponse.json({ tags });
}

// POST /api/admin/inbox/tags — create a tag definition.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can create tags." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", detail: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const input = body as Partial<TagWriteInput>;
  const required = ["slug", "label_en", "label_zh", "color"] as const;
  for (const k of required) {
    if (typeof input[k] !== "string") {
      return NextResponse.json(
        { error: "invalid_input", field: k, detail: `Missing or invalid '${k}'.` },
        { status: 400 },
      );
    }
  }

  const { tag, error } = await createTag(input as TagWriteInput, admin);
  if (error) {
    const status = error.field === "slug_conflict" ? 409 : 400;
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status },
    );
  }
  return NextResponse.json({ tag }, { status: 201 });
}
