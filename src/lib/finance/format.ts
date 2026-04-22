// Client-safe money formatter. Kept separate from finance-query.ts (which is
// server-only) so client components like TransactionRow + EnrollmentPicker
// can import without pulling the Supabase server client into the browser bundle.

export function formatMoney(amount: number, currency: string | null): string {
  const ccy = (currency ?? "").trim();
  const n = Math.round(amount * 100) / 100;
  const display = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!ccy || ccy === "—") return display;
  return `${ccy} ${display}`;
}
