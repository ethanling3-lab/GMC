import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";
import type { AdminContext } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { isHolidayRegion, sortHolidayRegions, type CalendarHoliday } from "./types";

// Admin-managed public holidays (calendar_holidays, migration 076).
// Service client + audit log; Super Admin only for writes (checked in the
// API routes). Reads are for every role that can open the calendar.

const COLUMNS = "id, date, name_en, name_cn, regions, estimated, source";

export type HolidayInput = {
  date: string;
  name_en: string;
  name_cn?: string | null;
  regions: string[];
  estimated?: boolean;
};

export type HolidayError = { field: "date" | "name_en" | "name_cn" | "regions" | "duplicate"; message: string };

function validate(input: Partial<HolidayInput>, partial = false): HolidayError | null {
  if (!partial || input.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
      return { field: "date", message: "Pick a valid date." };
    }
  }
  if (!partial || input.name_en !== undefined) {
    const n = (input.name_en ?? "").trim();
    if (n.length < 1 || n.length > 120) return { field: "name_en", message: "English name is required (max 120 characters)." };
  }
  if (input.name_cn != null && input.name_cn.length > 120) {
    return { field: "name_cn", message: "Chinese name is too long (max 120 characters)." };
  }
  if (!partial || input.regions !== undefined) {
    const r = input.regions ?? [];
    if (r.length === 0 || !r.every(isHolidayRegion)) {
      return { field: "regions", message: "Pick at least one region." };
    }
  }
  return null;
}

function clean(input: Partial<HolidayInput>) {
  const out: Record<string, unknown> = {};
  if (input.date !== undefined) out.date = input.date;
  if (input.name_en !== undefined) out.name_en = input.name_en.trim();
  if (input.name_cn !== undefined) out.name_cn = input.name_cn?.trim() || null;
  if (input.regions !== undefined) out.regions = sortHolidayRegions(input.regions);
  if (input.estimated !== undefined) out.estimated = Boolean(input.estimated);
  return out;
}

/** Holidays from Jan 1 of `fromYear` to Dec 31 of `toYear`. Returns [] if
 *  migration 076 isn't applied yet, so the calendar still renders. */
export async function listHolidays(fromYear: number, toYear: number): Promise<CalendarHoliday[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calendar_holidays")
    .select(COLUMNS)
    .gte("date", `${fromYear}-01-01`)
    .lte("date", `${toYear}-12-31`)
    .order("date", { ascending: true })
    .order("name_en", { ascending: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(`listHolidays failed: ${error.message}`);
  }
  return (data ?? []) as CalendarHoliday[];
}

export async function createHoliday(
  input: HolidayInput,
  admin: AdminContext,
): Promise<{ holiday?: CalendarHoliday; error?: HolidayError }> {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calendar_holidays")
    .insert({ ...clean(input), source: "manual", created_by: admin.id, updated_by: admin.id })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return { error: { field: "duplicate", message: "That holiday is already on this date." } };
    throw new Error(`createHoliday failed: ${error.message}`);
  }
  const holiday = data as CalendarHoliday;
  await writeAuditLog({
    actor_id: admin.id,
    action: "holiday.created",
    entity: "calendar_holiday",
    entity_id: holiday.id,
    after: { date: holiday.date, name_en: holiday.name_en, regions: holiday.regions },
  });
  return { holiday };
}

export async function updateHoliday(
  id: string,
  patch: Partial<HolidayInput>,
  admin: AdminContext,
): Promise<{ holiday?: CalendarHoliday; error?: HolidayError; notFound?: boolean }> {
  const err = validate(patch, true);
  if (err) return { error: err };
  const supabase = createSupabaseServiceClient();
  const { data: before } = await supabase.from("calendar_holidays").select(COLUMNS).eq("id", id).maybeSingle();
  if (!before) return { notFound: true };
  const { data, error } = await supabase
    .from("calendar_holidays")
    .update({ ...clean(patch), updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return { error: { field: "duplicate", message: "That holiday is already on this date." } };
    throw new Error(`updateHoliday failed: ${error.message}`);
  }
  const holiday = data as CalendarHoliday;
  await writeAuditLog({
    actor_id: admin.id,
    action: "holiday.updated",
    entity: "calendar_holiday",
    entity_id: id,
    before: before as Record<string, unknown>,
    after: holiday as unknown as Record<string, unknown>,
  });
  return { holiday };
}

export async function deleteHoliday(id: string, admin: AdminContext): Promise<{ notFound?: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { data: before } = await supabase.from("calendar_holidays").select(COLUMNS).eq("id", id).maybeSingle();
  if (!before) return { notFound: true };
  const { error } = await supabase.from("calendar_holidays").delete().eq("id", id);
  if (error) throw new Error(`deleteHoliday failed: ${error.message}`);
  await writeAuditLog({
    actor_id: admin.id,
    action: "holiday.deleted",
    entity: "calendar_holiday",
    entity_id: id,
    before: before as Record<string, unknown>,
  });
  return {};
}
