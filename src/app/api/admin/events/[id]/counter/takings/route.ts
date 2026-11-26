import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { loadTakings } from "@/lib/payments/counter";
import { sgDay } from "@/lib/pricing/tiers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/events/[id]/counter/takings?day=YYYY-MM-DD — today's takings at this counter.
export async function GET(req: Request, { params }: Ctx) {
  const guard = await requireFinanceAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get("day");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : sgDay();
  return NextResponse.json(await loadTakings(createSupabaseServiceClient(), id, day));
}
