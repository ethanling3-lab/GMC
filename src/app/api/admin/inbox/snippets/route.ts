import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSnippet, listSnippets } from "@/lib/inbox/snippets";
import type { SnippetWriteInput } from "@/lib/inbox/snippets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WRITE_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

// GET /api/admin/inbox/snippets — list active snippets.
export async function GET() {
  await requireAdmin();
  const snippets = await listSnippets();
  return NextResponse.json({ snippets });
}

// POST /api/admin/inbox/snippets — create a snippet.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!WRITE_ROLES.has(admin.role)) {
    return NextResponse.json(
      { error: "forbidden", detail: "Only super/regional/CS admins can create snippets." },
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

  const input = body as Partial<SnippetWriteInput>;
  const required = ["shortcut", "title_en", "title_zh", "body_en", "body_zh"] as const;
  for (const k of required) {
    if (typeof input[k] !== "string") {
      return NextResponse.json(
        { error: "invalid_input", field: k, detail: `Missing or invalid '${k}'.` },
        { status: 400 },
      );
    }
  }

  const { snippet, error } = await createSnippet(input as SnippetWriteInput, admin);
  if (error) {
    const status = error.field === "shortcut_conflict" ? 409 : 400;
    return NextResponse.json(
      { error: error.field, detail: error.message },
      { status },
    );
  }

  return NextResponse.json({ snippet }, { status: 201 });
}
