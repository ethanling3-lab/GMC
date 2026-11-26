import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { findPeople } from "@/lib/payments/counter";

export const dynamic = "force-dynamic";

// GET /api/admin/payments/people?q=…&event=<id> — find a person at the
// payment counter (or for a purchase). Finance + Super Admin. With `event`,
// each hit carries their registration for that event.
export async function GET(req: Request) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ rows: [] });
  const ev = url.searchParams.get("event");
  const eventId = ev && /^[0-9a-f-]{36}$/i.test(ev) ? ev : null;
  return NextResponse.json({ rows: await findPeople(createSupabaseServiceClient(), q, eventId) });
}
