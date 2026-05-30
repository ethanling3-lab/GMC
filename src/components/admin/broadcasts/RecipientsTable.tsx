import Link from "next/link";
import type {
  BroadcastChannel,
  BroadcastErrorCode,
  BroadcastRecipientStatus,
} from "@/lib/broadcasts/types";
import { BroadcastChannelPill } from "./BroadcastStatusPill";

type RecipientRow = {
  id: string;
  participant_id: string;
  channel: BroadcastChannel;
  target_address: string | null;
  status: BroadcastRecipientStatus;
  error_code: BroadcastErrorCode | null;
  error_message: string | null;
  sent_at: string | null;
  conversation_id: string | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
  } | null;
};

export function RecipientsTable({
  recipients,
  errorLabels,
}: {
  recipients: RecipientRow[];
  errorLabels: Record<BroadcastErrorCode, { en: string; cn: string }>;
}) {
  if (recipients.length === 0) {
    return (
      <p className="text-[13px] leading-[1.7] text-[var(--ink-mute)]">No recipients in this tab.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            <th className="pb-3 font-normal">Participant</th>
            <th className="pb-3 font-normal">Channel</th>
            <th className="pb-3 font-normal">Address</th>
            <th className="pb-3 font-normal">Error</th>
            <th className="pb-3 font-normal">Sent at</th>
            <th className="pb-3 font-normal text-right">Thread</th>
          </tr>
        </thead>
        <tbody>
          {recipients.map((r) => (
            <tr
              key={r.id}
              className="border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/50 transition-colors"
            >
              <td className="py-2.5 pr-4">
                <div className="text-[var(--ink)] truncate max-w-[260px]">
                  {[r.participant?.name_cn, r.participant?.name_en].filter(Boolean).join(" · ") ||
                    "—"}
                </div>
                <div className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)] tabular-nums">
                  {r.participant?.region_id ?? "—"}
                </div>
              </td>
              <td className="py-2.5 pr-4">
                <BroadcastChannelPill channel={r.channel} />
              </td>
              <td className="py-2.5 pr-4 text-[11.5px] text-[var(--ink-soft)] font-mono tabular-nums">
                {maskAddress(r.target_address, r.channel)}
              </td>
              <td className="py-2.5 pr-4 text-[11.5px]">
                {r.error_code ? (
                  <span
                    className="text-[var(--cinnabar-deep)]"
                    title={r.error_message ?? ""}
                  >
                    {errorLabels[r.error_code].en}
                  </span>
                ) : (
                  <span className="text-[var(--ink-faint)]">—</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-[11.5px] text-[var(--ink-soft)] tabular-nums">
                {r.sent_at ? formatDateTime(r.sent_at) : "—"}
              </td>
              <td className="py-2.5 text-right">
                {r.conversation_id ? (
                  <Link
                    href={`/admin/inbox/${r.conversation_id}`}
                    className="text-[11px] tracking-[0.1em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
                    style={{ color: "var(--cinnabar-deep)" }}
                  >
                    Open
                  </Link>
                ) : (
                  <span className="text-[var(--ink-faint)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function maskAddress(addr: string | null, channel: BroadcastChannel): string {
  if (!addr) return "—";
  if (channel === "email") {
    const [local, domain] = addr.split("@");
    if (!local || !domain) return addr;
    return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
  }
  // Phone — show last 4.
  if (addr.length <= 6) return addr;
  return `${addr.slice(0, 3)}${"*".repeat(addr.length - 7)}${addr.slice(-4)}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
