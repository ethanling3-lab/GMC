import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { BroadcastComposer } from "@/components/admin/broadcasts/BroadcastComposer";
import { loadActiveProgrammes } from "@/lib/programmes/load";

export const metadata: Metadata = { title: "New broadcast" };
export const dynamic = "force-dynamic";

export default async function NewBroadcastPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin" && admin.role !== "regional_lead") {
    redirect("/admin/broadcasts");
  }

  const supabase = await createSupabaseServerClient();

  // Events for the event-cohort tab event picker. Open events first,
  // then everything else (draft + closed + archived) so admins can blast
  // a closed event's cohort for post-event comms.
  const { data: events } = await supabase
    .from("events")
    .select("id, title_en, title_cn, status, start_date, city, slug")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);

  const programmes = (await loadActiveProgrammes()).map((p) => ({
    value: p.slug,
    label_cn: p.name_cn,
    label_en: p.name_en,
  }));

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Communication · 新建群发
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Compose a broadcast.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            Pick channels, an audience, your content. We&apos;ll preview the
            reach and let you send now or schedule for later.
          </p>
        </div>
      </div>

      <section className="mt-10">
        <BroadcastComposer
          adminRegion={admin.region}
          programmes={programmes}
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
