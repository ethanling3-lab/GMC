import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

type StatCard = { label: string; value: string; hint?: string };

async function loadStats(): Promise<StatCard[]> {
  const supabase = await createSupabaseServerClient();
  const [participants, enrollments, events] = await Promise.all([
    supabase.from("participants").select("id", { count: "exact", head: true }),
    supabase.from("enrollments").select("id", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
  ]);

  const fmt = (n: number | null | undefined) =>
    typeof n === "number" ? n.toLocaleString() : "—";

  return [
    { label: "Participants", value: fmt(participants.count), hint: "across all regions" },
    { label: "Enrollments", value: fmt(enrollments.count), hint: "all events combined" },
    { label: "Events", value: fmt(events.count), hint: "draft + open + closed + archived" },
  ];
}

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const stats = await loadStats();

  const greeting = admin.name_en ?? admin.name_cn ?? admin.email;

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--ink-mute)]">
        Overview
      </div>
      <h1 className="mt-3 font-display text-[40px] leading-[1.05] text-[var(--ink)]">
        Welcome, {greeting}.
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--ink-soft)]">
        This is the GMC administration workspace. Participants sit at the centre;
        events, travel, finance and broadcasts all flow from there.
      </p>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
        {stats.map((s) => (
          <article
            key={s.label}
            className="border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-6 py-7 shadow-[var(--shadow-paper-1)]"
          >
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              {s.label}
            </div>
            <div className="mt-4 font-display text-[40px] leading-[1] text-[var(--ink)]">
              {s.value}
            </div>
            {s.hint ? (
              <div className="mt-3 text-[12px] text-[var(--ink-mute)]">{s.hint}</div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="mt-16 border-t border-[var(--paper-shadow)] pt-10">
        <div className="text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
          Getting started
        </div>
        <ul className="mt-5 space-y-3 text-[14px] leading-[1.75] text-[var(--ink-soft)] max-w-[68ch]">
          <li>· Open <span className="font-mono text-[13px]">Participants</span> to review the student master. Region IDs are assigned on registration.</li>
          <li>· Event CMS, travel capture, finance and notifications arrive in upcoming milestones.</li>
          <li>· All external exports use region IDs by default. Names are visible inside this workspace only.</li>
        </ul>
      </div>
    </div>
  );
}
