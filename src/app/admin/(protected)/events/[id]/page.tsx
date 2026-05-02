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
    "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, poster_url, gallery, type, mode, venue, city, country, start_date, end_date, arrival_day, departure_day, enrollment_opens_at, enrollment_closes_at, capacity, price, currency, payment_methods, target_audience_filter, status, requires_approval, form_schema, bank_details, created_at, updated_at";
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
      // Migration 008 not applied — fall back and default form_schema to {}.
      const fallback = await supabase
        .from("events")
        .select(columnsLegacy)
        .eq("id", id)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      data = fallback.data
        ? { ...fallback.data, form_schema: {}, bank_details: {} }
        : null;
    } else {
      data = primary.data;
    }
  }
  if (!data) notFound();

  const event = data as EventFull;

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
