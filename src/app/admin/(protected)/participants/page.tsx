import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "Participants" };

type ParticipantRow = {
  id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  region: string | null;
  status:
    | "new"
    | "info_verified"
    | "cs_enriched"
    | "active"
    | "inactive";
  created_at: string;
};

const STATUS_LABEL: Record<ParticipantRow["status"], string> = {
  new: "New",
  info_verified: "Info Verified",
  cs_enriched: "CS Enriched",
  active: "Active",
  inactive: "Inactive",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function combinedName(r: ParticipantRow): string {
  const en = r.name_en?.trim();
  const cn = r.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

async function loadParticipants(): Promise<{ rows: ParticipantRow[]; count: number | null }> {
  const supabase = await createSupabaseServerClient();
  const { data, count } = await supabase
    .from("participants")
    .select("id, region_id, name_cn, name_en, region, status, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .limit(100);

  return { rows: (data ?? []) as ParticipantRow[], count };
}

export default async function ParticipantsPage() {
  await requireAdmin();
  const { rows, count } = await loadParticipants();

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--ink-mute)]">
            Student master
          </div>
          <h1 className="mt-3 font-display text-[40px] leading-[1.05] text-[var(--ink)]">
            Participants
          </h1>
          <p className="mt-3 text-[14px] text-[var(--ink-soft)] max-w-[62ch]">
            Shared across all events. Region IDs are assigned automatically on registration
            and are used for all external references.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            Total
          </div>
          <div className="font-display text-[28px] leading-[1] text-[var(--ink)]">
            {typeof count === "number" ? count.toLocaleString() : "—"}
          </div>
        </div>
      </div>

      <div className="mt-10 border border-[var(--paper-shadow)] bg-[var(--paper-warm)] overflow-x-auto">
        <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
          <thead className="bg-[var(--paper-deep)] text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
            <tr>
              <th scope="col" className="px-5 py-3 font-normal">Region ID</th>
              <th scope="col" className="px-5 py-3 font-normal">Name</th>
              <th scope="col" className="px-5 py-3 font-normal">Region</th>
              <th scope="col" className="px-5 py-3 font-normal">Status</th>
              <th scope="col" className="px-5 py-3 font-normal text-right">Registered</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-[var(--ink-mute)]">
                  No participants yet. Public registrations will appear here.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)] transition-colors duration-[var(--dur-fast)]"
                >
                  <td className="px-5 py-3 font-mono text-[12px] text-[var(--ink)]">
                    {r.region_id ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-[var(--ink)]">{combinedName(r)}</td>
                  <td className="px-5 py-3 text-[var(--ink-mute)]">{r.region ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-2 px-2 py-0.5 border border-[var(--paper-shadow)] text-[10px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" />
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-[var(--ink-mute)]">
                    {formatDate(r.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
        Showing the most recent 100. Search, filters, and regional scoping arrive with the full M2 milestone.
      </p>
    </div>
  );
}
