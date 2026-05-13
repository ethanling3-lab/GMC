import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { loadProfileDeck } from "@/lib/profile-deck/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — fetch profile-deck payload (event meta + ordered participant rows).
// POST — fire-and-forget audit log after a successful client-side render.
//
// Render itself happens client-side via pptxgenjs, identical pattern to
// the floor-plan export. The server's job here is auth + the cross-table
// join, since the loader needs the service role to see admin-only fields
// (dharma_name, religion, attended_courses, scoring) on participants.

const PostBody = z.object({
  format: z.enum(["pptx"]),
  participant_count: z.number().int().min(0).max(5000),
  include_photos: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

function gateRoles(role: string): boolean {
  return (
    role === "super_admin"
    || role === "regional_lead"
    || role === "instructor"
  );
}

export async function GET(_req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!gateRoles(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;
  try {
    const payload = await loadProfileDeck(eventId);
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load_failed";
    if (msg === "event_not_found") {
      return NextResponse.json({ error: "event_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "load_failed", detail: msg },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: RouteCtx) {
  const admin = await requireAdmin();
  if (!gateRoles(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: eventId } = await params;

  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", detail: parsed.error.message },
      { status: 400 },
    );
  }

  await writeAuditLog({
    actor_id: admin.id,
    action: "profile_deck.exported",
    entity: "event",
    entity_id: eventId,
    metadata: {
      format: parsed.data.format,
      participant_count: parsed.data.participant_count,
      include_photos: parsed.data.include_photos ?? true,
    },
  });

  return NextResponse.json({ ok: true });
}
