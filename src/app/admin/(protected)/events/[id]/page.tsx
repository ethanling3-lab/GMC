import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  EventEditor,
  type EventFull,
} from "@/components/admin/events/EventEditor";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "Edit event" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EventDetailPage({ params }: PageProps) {
  const admin = await requireAdmin();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const columnsWithSchema =
    "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, poster_url, gallery, type, mode, venue, city, country, start_date, end_date, arrival_day, departure_day, enrollment_opens_at, enrollment_closes_at, capacity, price, currency, payment_methods, target_audience_filter, status, requires_approval, form_schema, bank_details, main_venue_hotel_name, designated_hotels, transfer_rules, seating_mode, group_size_min, group_size_max, created_at, updated_at";
  const columnsLegacy =
    "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, poster_url, gallery, type, mode, venue, city, country, start_date, end_date, arrival_day, departure_day, enrollment_opens_at, enrollment_closes_at, capacity, price, currency, payment_methods, target_audience_filter, status, requires_approval, created_at, updated_at";

  let data: Record<string, unknown> | null = null;
  {
    const primary = await supabase
      .from("events")
      .select(columnsWithSchema)
      .eq("id", id)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      // Migration 008/018 not applied — fall back to a column set that
      // pre-dates both, then synthesize the missing fields with defaults.
      const fallback = await supabase
        .from("events")
        .select(columnsLegacy)
        .eq("id", id)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      data = fallback.data
        ? {
            ...fallback.data,
            form_schema: {},
            bank_details: {},
            main_venue_hotel_name: null,
            designated_hotels: {},
            transfer_rules: {},
            seating_mode: "tables",
            group_size_min: 10,
            group_size_max: 12,
          }
        : null;
    } else {
      data = primary.data;
    }
  }
  if (!data) notFound();

  // Coerce JSONB columns to plain objects — both default to {} when null.
  const raw = data as Record<string, unknown>;
  const event = {
    ...raw,
    designated_hotels:
      raw.designated_hotels &&
      typeof raw.designated_hotels === "object" &&
      !Array.isArray(raw.designated_hotels)
        ? (raw.designated_hotels as Record<string, string>)
        : {},
    transfer_rules:
      raw.transfer_rules &&
      typeof raw.transfer_rules === "object" &&
      !Array.isArray(raw.transfer_rules)
        ? (raw.transfer_rules as Record<string, unknown>)
        : {},
  } as EventFull;

  const canEdit = admin.role === "super_admin";
  const canDelete = admin.role === "super_admin";

  const { count: enrollmentCount } = await supabase
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);

  const crumbLabel =
    event.title_en || event.title_cn
      ? `${event.title_en ?? ""}${event.title_en && event.title_cn ? " · " : ""}${event.title_cn ?? ""}`
      : event.slug;

  return (
    <>
      <CrumbLabel segment={event.id} label={crumbLabel} />
      <EventEditor
        event={event}
        canEdit={canEdit}
        canDelete={canDelete}
        enrollmentCount={enrollmentCount ?? 0}
      />
    </>
  );
}
