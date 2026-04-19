import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  EventEditor,
  type EventFull,
} from "@/components/admin/events/EventEditor";

export const metadata: Metadata = { title: "Edit event" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EventDetailPage({ params }: PageProps) {
  const admin = await requireAdmin();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title_en, title_cn, heading_en, heading_cn, sub_heading_en, sub_heading_cn, body_en, body_cn, poster_url, gallery, type, mode, venue, city, country, start_date, end_date, departure_day, enrollment_opens_at, enrollment_closes_at, capacity, price, currency, payment_methods, target_audience_filter, status, requires_approval, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) notFound();

  const event = data as EventFull;

  const canEdit = admin.role === "super_admin";
  const canDelete = admin.role === "super_admin";

  return <EventEditor event={event} canEdit={canEdit} canDelete={canDelete} />;
}
