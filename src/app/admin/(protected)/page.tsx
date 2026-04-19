import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

type StatCard = {
  label: string;
  labelZh: string;
  value: string;
  hint?: string;
  accent?: "blue" | "slate" | "ink" | "gold";
};

type RegionSlice = {
  code: string;
  nameEn: string;
  nameZh: string;
  count: number;
};

const REGIONS: Omit<RegionSlice, "count">[] = [
  { code: "MY", nameEn: "Malaysia", nameZh: "马来西亚" },
  { code: "SG", nameEn: "Singapore", nameZh: "新加坡" },
  { code: "TW", nameEn: "Taiwan", nameZh: "台湾" },
  { code: "HK", nameEn: "Hong Kong", nameZh: "香港" },
  { code: "CN", nameEn: "Mainland China", nameZh: "中国大陆" },
];

async function loadStats(): Promise<{ cards: StatCard[]; regions: RegionSlice[] }> {
  const supabase = await createSupabaseServerClient();
  const [participants, enrollments, events] = await Promise.all([
    supabase.from("participants").select("id", { count: "exact", head: true }),
    supabase.from("enrollments").select("id", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
  ]);

  const regionCounts = await Promise.all(
    REGIONS.map(async (r) => {
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("region", r.code);
      return { ...r, count: count ?? 0 };
    }),
  );

  const regionsActive = regionCounts.filter((r) => r.count > 0).length;

  const fmt = (n: number | null | undefined) =>
    typeof n === "number" ? n.toLocaleString() : "—";

  const cards: StatCard[] = [
    {
      label: "Participants",
      labelZh: "学员",
      value: fmt(participants.count),
      hint: "master list across regions",
      accent: "blue",
    },
    {
      label: "Enrollments",
      labelZh: "报名",
      value: fmt(enrollments.count),
      hint: "all events combined",
      accent: "slate",
    },
    {
      label: "Events",
      labelZh: "活动",
      value: fmt(events.count),
      hint: "draft · open · closed",
      accent: "ink",
    },
    {
      label: "Regions active",
      labelZh: "活跃地区",
      value: `${regionsActive} / ${REGIONS.length}`,
      hint: "with at least one participant",
      accent: "gold",
    },
  ];

  return { cards, regions: regionCounts };
}

function accentStyles(accent: StatCard["accent"]): { rail: string; dot: string } {
  switch (accent) {
    case "slate":
      return {
        rail: "linear-gradient(180deg, var(--jade) 0%, rgba(122,143,179,0) 100%)",
        dot: "var(--jade)",
      };
    case "ink":
      return {
        rail: "linear-gradient(180deg, var(--ink) 0%, rgba(11,41,84,0) 100%)",
        dot: "var(--ink)",
      };
    case "gold":
      return {
        rail: "linear-gradient(180deg, var(--cinnabar-soft) 0%, rgba(125,164,244,0) 100%)",
        dot: "var(--cinnabar-soft)",
      };
    case "blue":
    default:
      return {
        rail: "linear-gradient(180deg, var(--cinnabar) 0%, rgba(37,99,235,0) 100%)",
        dot: "var(--cinnabar)",
      };
  }
}

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const { cards, regions } = await loadStats();

  const greeting = admin.name_en ?? admin.name_cn ?? admin.email;
  const totalParticipants = regions.reduce((sum, r) => sum + r.count, 0);
  const maxRegion = Math.max(1, ...regions.map((r) => r.count));

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Overview · 概览
          </div>
          <h1 className="mt-4 font-display text-[40px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Welcome, {greeting}.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--ink-soft)]">
            The GMC administration workspace. Participants sit at the centre —
            events, travel, finance and broadcasts all flow from there.
          </p>
        </div>

        <div className="text-right">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Today
          </div>
          <div className="mt-1 font-display text-[22px] leading-[1.1] text-[var(--ink)]">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
        </div>
      </div>

      {/* Stats — 4 cards */}
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {cards.map((s) => {
          const a = accentStyles(s.accent);
          return (
            <article
              key={s.label}
              className="group relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)]
                         bg-[var(--paper-warm)] overflow-hidden
                         shadow-[var(--shadow-paper-1)]
                         transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:-translate-y-[2px] hover:shadow-[var(--shadow-paper-2)]"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full"
                style={{ background: a.rail }}
              />

              <div className="px-6 py-6 pl-7">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: a.dot }}
                      aria-hidden="true"
                    />
                    <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
                      {s.label}
                    </div>
                  </div>
                  <div
                    className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]"
                    aria-hidden="true"
                  >
                    {s.labelZh}
                  </div>
                </div>

                <div className="mt-5 font-display text-[40px] leading-[1] tracking-[-0.02em] text-[var(--ink)]">
                  {s.value}
                </div>

                {s.hint ? (
                  <div className="mt-3 text-[12px] leading-[1.55] text-[var(--ink-mute)]">
                    {s.hint}
                  </div>
                ) : null}
              </div>

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-base)]"
                style={{
                  background:
                    "radial-gradient(400px 180px at 100% 0%, rgba(37,99,235,0.06), transparent 70%)",
                }}
              />
            </article>
          );
        })}
      </div>

      {/* Region breakdown + Activity */}
      <section className="mt-14 grid lg:grid-cols-[1.15fr_0.85fr] gap-8">
        {/* Region breakdown */}
        <div className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-7 shadow-[var(--shadow-paper-1)]">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-5 h-px bg-current" />
                Regions · 地区
              </div>
              <h2 className="mt-3 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
                Participants by region
              </h2>
            </div>
            <div className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Total · {totalParticipants.toLocaleString()}
            </div>
          </div>

          <ul className="mt-6 flex flex-col gap-4">
            {regions.map((r) => {
              const pct = totalParticipants
                ? (r.count / totalParticipants) * 100
                : 0;
              const width = Math.max(2, (r.count / maxRegion) * 100);
              return (
                <li key={r.code} className="grid grid-cols-[56px_1fr_auto] gap-4 items-center">
                  <div className="flex flex-col">
                    <span className="font-display text-[15px] leading-none text-[var(--ink)]">
                      {r.code}
                    </span>
                    <span className="mt-1 text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                      {r.nameEn}
                    </span>
                  </div>

                  <div className="relative h-[6px] rounded-full bg-[var(--paper-deep)] overflow-hidden">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full
                                 transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
                      style={{
                        width: `${width}%`,
                        background:
                          r.count > 0
                            ? "linear-gradient(90deg, var(--cinnabar) 0%, var(--cinnabar-soft) 100%)"
                            : "transparent",
                      }}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="text-right tabular-nums">
                    <div className="font-display text-[16px] leading-none text-[var(--ink)]">
                      {r.count.toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)] text-[12px] leading-[1.7] text-[var(--ink-mute)]">
            Region IDs (MY · SG · TW · HK · CN) are assigned on registration and stay with
            the participant across every event.
          </div>
        </div>

        {/* Activity placeholder */}
        <div className="relative rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 p-7 flex flex-col">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Activity · 动态
          </div>
          <h2 className="mt-3 font-display text-[22px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">
            Recent admin activity
          </h2>

          <div className="mt-6 flex-1 flex flex-col items-start gap-5">
            {[
              {
                tag: "— 01",
                title: "Participant master",
                body: "Full register, passport status, region IDs. Edit from /participants.",
              },
              {
                tag: "— 02",
                title: "Travel capture",
                body: "WhatsApp image OCR → transfer list in M5.",
              },
              {
                tag: "— 03",
                title: "Broadcasts",
                body: "Audience filter DSL + WhatsApp Business API in M7.",
              },
            ].map((step) => (
              <div key={step.tag} className="grid grid-cols-[44px_1fr] gap-3 items-start w-full">
                <span className="font-display text-[12px] tracking-[0.22em] text-[var(--cinnabar)] pt-0.5">
                  {step.tag}
                </span>
                <div>
                  <div className="text-[13.5px] font-medium text-[var(--ink)]">
                    {step.title}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-[1.65] text-[var(--ink-soft)]">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-dashed border-[var(--paper-shadow)] text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Activity feed · arrives in M7
          </div>
        </div>
      </section>

      {/* Privacy note */}
      <section className="mt-12 flex items-center gap-4 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        <span className="w-6 h-px bg-[var(--paper-shadow)]" />
        <span>Privacy · full names stay inside this workspace. External exports use region IDs.</span>
      </section>
    </div>
  );
}
