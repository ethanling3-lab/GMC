import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { loadCounterEvent, loadCounterPerson, newPersonQuote } from "@/lib/payments/counter";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/events/[id]/counter/person?id=<participant>  — one person's counter view.
// GET …/person (no id) — the price a brand-new person would pay (新人).
export async function GET(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id: eventId } = await params;
  const service = createSupabaseServiceClient();
  const event = await loadCounterEvent(service, eventId);
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  const pid = new URL(req.url).searchParams.get("id");
  if (!pid) return NextResponse.json({ quote: await newPersonQuote(service, event) });
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const person = await loadCounterPerson(service, event, pid);
  if (!person) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ person });
}
