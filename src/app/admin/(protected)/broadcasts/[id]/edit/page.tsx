import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  BroadcastComposer,
  type ExistingBroadcast,
} from "@/components/admin/broadcasts/BroadcastComposer";
import type { AudienceFilter, BroadcastChannel, BroadcastStatus } from "@/lib/broadcasts/types";

export const metadata: Metadata = { title: "Edit broadcast" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditBroadcastPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin/broadcasts");
  }

  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select(
      "id, name, audience_mode, audience_filter, channels, whatsapp_template_name, whatsapp_template_language, whatsapp_template_params, email_subject_en, email_subject_cn, email_body_en, email_body_cn, status, scheduled_for, deleted_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!broadcast) notFound();
  const b = broadcast as unknown as ExistingBroadcast & {
    status: BroadcastStatus;
    deleted_at: string | null;
  };
  if (b.deleted_at) notFound();

  // Only draft / scheduled are editable — the PATCH route enforces this too,
  // but bounce early so the composer never renders for a locked broadcast.
  if (b.status !== "draft" && b.status !== "scheduled") {
    redirect(`/admin/broadcasts/${id}`);
  }

  // Events for the event-cohort picker (same source as the new-broadcast page).
  const { data: events } = await supabase
    .from("events")
    .select("id, title_en, title_cn, status, start_date, city, slug")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);

  const existing: ExistingBroadcast = {
    id: b.id,
    name: b.name,
    channels: b.channels as BroadcastChannel[],
    audience_mode: b.audience_mode,
    audience_filter: b.audience_filter as AudienceFilter,
    whatsapp_template_name: b.whatsapp_template_name,
    whatsapp_template_language: b.whatsapp_template_language,
    whatsapp_template_params: b.whatsapp_template_params,
    email_subject_en: b.email_subject_en,
    email_subject_cn: b.email_subject_cn,
    email_body_en: b.email_body_en,
    email_body_cn: b.email_body_cn,
    scheduled_for: b.scheduled_for,
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <Link
              href={`/admin/broadcasts/${id}`}
              className="hover:text-[var(--cinnabar-deep)]"
              style={{ color: "var(--cinnabar)" }}
            >
              Communication · 群发
            </Link>
            <span className="text-[var(--ink-faint)]">›</span>
            <span className="text-[var(--ink-mute)]">Edit · 编辑</span>
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)] truncate">
            Edit broadcast.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            {b.status === "scheduled"
              ? "This broadcast is scheduled. Changes save in place; it still sends at its scheduled time unless you reschedule or send now."
              : "Adjust channels, audience, or content. Save the draft, or send / schedule when ready."}
          </p>
        </div>
      </div>

      <section className="mt-10">
        <BroadcastComposer
          adminRegion={admin.region}
          existing={existing}
          events={(events ?? []) as Array<{
            id: string;
            title_en: string | null;
            title_cn: string | null;
            status: string;
            start_date: string | null;
            city: string | null;
            slug: string;
          }>}
        />
      </section>
    </div>
  );
}
