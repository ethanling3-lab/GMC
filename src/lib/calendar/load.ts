import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { CalendarCourse, CalendarSession } from "./types";

// Sessions overlapping a calendar year. Server-side with the service
// client and an EXPLICIT status filter: drafts only for Super Admin,
// archived never — so limited roles can't see work-in-progress.
export async function loadCalendarYear(
  year: number,
  { includeDrafts }: { includeDrafts: boolean },
): Promise<{ sessions: CalendarSession[]; courses: CalendarCourse[] }> {
  const service = createSupabaseServiceClient();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const statuses = includeDrafts
    ? ["draft", "planned", "open", "closed"]
    : ["planned", "open", "closed"];

  const [evRes, cRes] = await Promise.all([
    service
      .from("events")
      .select("id, slug, title_en, title_cn, status, start_date, end_date, dates_tentative, city, country, course_id")
      .in("status", statuses)
      .not("start_date", "is", null)
      .lte("start_date", to)
      .or(`end_date.gte.${from},and(end_date.is.null,start_date.gte.${from})`)
      .order("start_date", { ascending: true })
      .returns<CalendarSession[]>(),
    service
      .from("courses")
      .select("id, slug, name_en, name_cn, short_label, colour")
      .order("sort_order", { ascending: true })
      .order("name_en", { ascending: true })
      .returns<CalendarCourse[]>(),
  ]);
  if (evRes.error) throw new Error(`calendar events: ${evRes.error.message}`);
  if (cRes.error) throw new Error(`calendar courses: ${cRes.error.message}`);
  return { sessions: evRes.data ?? [], courses: cRes.data ?? [] };
}
