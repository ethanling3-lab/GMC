import "server-only";
import { NextResponse } from "next/server";
import { requireAdmin, type AdminContext } from "@/lib/admin-guard";

// Finance routes: super_admin + finance can mutate. No other role may touch
// bank imports / reconciliation. This is the single choke-point so every
// finance route stays in sync.

export async function requireFinanceAdmin(): Promise<
  | { ok: true; admin: AdminContext }
  | { ok: false; response: NextResponse }
> {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "finance") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "forbidden", detail: "Only finance or super admins can access this" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, admin };
}
