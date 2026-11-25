import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-guard";
import { loadCalendarYear } from "@/lib/calendar/load";
import { listHolidays } from "@/lib/calendar/holiday-store";
import { CalendarClient } from "@/components/admin/calendar/CalendarClient";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

// Year calendar of courses / events (Phase 1). Entries are the real event
// rows — created early as "planned", opened for registration later.
// Super Admin plans + edits; CS and Finance view (see permissions.ts).

type PageProps = { searchParams: Promise<{ year?: string; view?: string; month?: string }> };

export default async function CalendarPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const nowSg = new Date(Date.now() + 8 * 3600_000);
  const thisYear = nowSg.getUTCFullYear();
  const yearNum = Number(sp.year);
  const year = Number.isInteger(yearNum) && yearNum >= 2020 && yearNum <= 2100 ? yearNum : thisYear;
  const monthNum = Number(sp.month);
  const month =
    Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
      ? monthNum
      : year === thisYear
        ? nowSg.getUTCMonth() + 1
        : 1;
  const view = sp.view === "month" ? "month" : "year";
  const canPlan = admin.role === "super_admin";

  const { sessions, courses } = await loadCalendarYear(year, { includeDrafts: canPlan });
  // This year + next, so planning a session early next year still warns.
  const holidays = await listHolidays(year, year + 1);

  return (
    <CalendarClient
      year={year}
      month={month}
      view={view}
      today={nowSg.toISOString().slice(0, 10)}
      sessions={sessions}
      courses={courses}
      holidays={holidays}
      canPlan={canPlan}
    />
  );
}
