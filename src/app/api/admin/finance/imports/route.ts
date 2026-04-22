import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { requireFinanceAdmin } from "@/lib/finance/role-guard";
import { parseBankFile } from "@/lib/finance/csv-parse";
import { matchBankTransaction } from "@/lib/finance/bank-match";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 5 MB — bank CSVs are tiny even for big exports

// POST multipart/form-data with a single `file` field.
//
// Pipeline:
//   1. Parse + normalize rows (csv-parse.ts)
//   2. For each row, run the match engine (bank-match.ts) in one pass
//   3. Insert a bank_imports row + N bank_transactions rows
//   4. Update per-status counters on the parent import
//   5. Return the import id + the rows so the UI can route to the review screen
//
// We do NOT mutate enrolments here. Auto-matched txns still require admin
// confirmation before we flip the enrolment to paid — every finance action
// that touches money stays in an admin's hands.
export async function POST(req: Request) {
  const auth = await requireFinanceAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "file_too_large", detail: `Max ${MAX_FILE_SIZE / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  const filename = file.name || "upload.csv";
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed: ReturnType<typeof parseBankFile>;
  try {
    parsed = parseBankFile(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "parse_failed";
    return NextResponse.json({ error: "parse_failed", detail: msg }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "no_rows", detail: "Couldn't detect any transaction rows." },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  // Create the import row first so every txn carries a valid import_id.
  const { data: importRow, error: importErr } = await service
    .from("bank_imports")
    .insert({
      uploaded_by: admin.id,
      filename,
      row_count: parsed.rows.length,
      notes: null,
    })
    .select("id")
    .single();
  if (importErr || !importRow) {
    return NextResponse.json(
      { error: "import_insert_failed", detail: importErr?.message },
      { status: 500 },
    );
  }

  // Match each row against the enrolment pool. We intentionally run these
  // sequentially rather than in parallel: the matcher loads the enrolment
  // pool once per call and caching it in memory would complicate the pure-
  // function contract. For typical bank exports (≤ a few hundred rows) this
  // is fast enough.
  type TxnInsert = {
    import_id: string;
    txn_date: string | null;
    amount: number;
    currency: string | null;
    raw_name: string | null;
    raw_reference: string | null;
    raw_row: Record<string, unknown>;
    status: string;
    matched_enrollment_id: string | null;
    match_confidence: number | null;
    match_basis: string | null;
    note: string | null;
  };
  const toInsert: TxnInsert[] = [];

  let autoMatched = 0;
  let suggested = 0;
  let unmatched = 0;

  for (const row of parsed.rows) {
    // Rows with parse issues skip the matcher and land as unmatched with a
    // note so the UI knows they need manual review.
    if (row.issues.length > 0 || row.txn_date == null || row.amount == null) {
      toInsert.push({
        import_id: importRow.id,
        txn_date: row.txn_date,
        amount: row.amount ?? 0,
        currency: row.currency,
        raw_name: row.raw_name,
        raw_reference: row.raw_reference,
        raw_row: row.raw_row,
        status: "unmatched",
        matched_enrollment_id: null,
        match_confidence: null,
        match_basis: null,
        note: row.issues.length > 0 ? `parse: ${row.issues.join(",")}` : null,
      });
      unmatched++;
      continue;
    }

    // Only match positive inflows. Negatives are typically refunds and
    // shouldn't auto-match into an enrolment.
    if (row.amount <= 0) {
      toInsert.push({
        import_id: importRow.id,
        txn_date: row.txn_date,
        amount: row.amount,
        currency: row.currency,
        raw_name: row.raw_name,
        raw_reference: row.raw_reference,
        raw_row: row.raw_row,
        status: "unmatched",
        matched_enrollment_id: null,
        match_confidence: null,
        match_basis: null,
        note: "outflow — review as refund or skip",
      });
      unmatched++;
      continue;
    }

    const result = await matchBankTransaction(service, {
      txn_date: row.txn_date,
      amount: row.amount,
      raw_name: row.raw_name,
      raw_reference: row.raw_reference,
    }).catch((err) => {
      console.warn("[finance.import] match failed", err);
      return null;
    });

    if (!result) {
      toInsert.push({
        import_id: importRow.id,
        txn_date: row.txn_date,
        amount: row.amount,
        currency: row.currency,
        raw_name: row.raw_name,
        raw_reference: row.raw_reference,
        raw_row: row.raw_row,
        status: "unmatched",
        matched_enrollment_id: null,
        match_confidence: null,
        match_basis: null,
        note: "match_engine_error",
      });
      unmatched++;
      continue;
    }

    if (result.status === "auto_matched") autoMatched++;
    else if (result.status === "suggested") suggested++;
    else unmatched++;

    toInsert.push({
      import_id: importRow.id,
      txn_date: row.txn_date,
      amount: row.amount,
      currency: row.currency,
      raw_name: row.raw_name,
      raw_reference: row.raw_reference,
      raw_row: row.raw_row,
      status: result.status,
      matched_enrollment_id: result.matched?.enrollment_id ?? null,
      match_confidence: result.confidence,
      match_basis: result.basis,
      note: null,
    });
  }

  // Bulk-insert txns. If this fails, delete the bank_imports row so we
  // don't leak an empty parent.
  const { error: txnErr } = await service
    .from("bank_transactions")
    .insert(toInsert);
  if (txnErr) {
    await service.from("bank_imports").delete().eq("id", importRow.id);
    return NextResponse.json(
      { error: "transactions_insert_failed", detail: txnErr.message },
      { status: 500 },
    );
  }

  // Update parent import counters.
  await service
    .from("bank_imports")
    .update({
      auto_matched_count: autoMatched,
      suggested_count: suggested,
      unmatched_count: unmatched,
    })
    .eq("id", importRow.id);

  await writeAuditLog({
    actor_id: admin.id,
    action: "finance.bank_import_created",
    entity: "bank_imports",
    entity_id: importRow.id,
    metadata: {
      filename,
      row_count: parsed.rows.length,
      auto_matched: autoMatched,
      suggested,
      unmatched,
      header_map: parsed.headerMap,
    },
  });

  return NextResponse.json({
    ok: true,
    import_id: importRow.id,
    row_count: parsed.rows.length,
    auto_matched: autoMatched,
    suggested,
    unmatched,
    header_map: parsed.headerMap,
  });
}
