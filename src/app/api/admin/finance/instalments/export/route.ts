import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadInstalments, parseInstalmentFilters } from "@/lib/payments/instalments";
import { STATE_LABEL } from "@/lib/payments/types";
import { sgDay } from "@/lib/pricing/tiers";

export const dynamic = "force-dynamic";

// GET /api/admin/finance/instalments/export?… — same filters as the page.
// Finance + Super Admin see all; CS only their own customers.
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!["super_admin", "finance", "customer_service"].includes(admin.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseInstalmentFilters(sp);
  const rows = await loadInstalments(createSupabaseServiceClient(), f, {
    csId: admin.role === "customer_service" ? admin.id : null,
  });
  const head = [
    "student_id", "name", "phone", "cs", "purchase", "programme", "registered_on", "total_sgd", "paid_sgd",
    "balance_sgd", "behind_sgd", "standing", "next_row", "next_due", "next_amount_sgd", "status",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    const s = r.standing;
    lines.push(
      [
        r.person.region_id, r.person.name, r.person.phone, r.person.cs_name, r.title, r.programme_name, r.registered_on,
        s.total, s.paid, s.balance, s.behind, `${STATE_LABEL[s.state].cn} ${STATE_LABEL[s.state].en}`,
        s.next?.label, s.next?.due_on, s.next?.remaining, r.status,
      ].map(cell).join(","),
    );
  }
  return new NextResponse("﻿" + lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="instalments-${f.view}-${sgDay()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
