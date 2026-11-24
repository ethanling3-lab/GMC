import type { HistoryEntry } from "@/lib/participants/history";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  });

export function ParticipantHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <details className="group rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-5 py-4 hover:bg-[var(--paper-deep)]/50 focus-visible:shadow-[var(--shadow-focus)] active:bg-[var(--paper-deep)] transition-[background-color] duration-[var(--dur-fast)]">
        <span className="font-display text-[20px] leading-[1.2] text-[var(--ink)]">
          Edit history · 修改记录
        </span>
        <span className="text-[12px] text-[var(--ink-mute)] tabular-nums">
          {entries.length === 0 ? "No edits yet" : `${entries.length} recorded`}
        </span>
      </summary>
      {entries.length === 0 ? (
        <p className="border-t border-[var(--paper-shadow)] px-5 py-4 text-[13px] leading-[1.7] text-[var(--ink-mute)]">
          Changes will appear here with who made them and when.
          修改后将在此显示修改人和时间。
        </p>
      ) : (
        <ol className="border-t border-[var(--paper-shadow)]">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="border-b border-[var(--paper-shadow)] px-5 py-3.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[13px] font-medium text-[var(--ink)]">{entry.actor}</span>
                <time dateTime={entry.at} className="text-[12px] text-[var(--ink-mute)] tabular-nums">
                  {formatWhen(entry.at)}
                </time>
              </div>
              {entry.label ? (
                <p className="mt-1 text-[12.5px] text-[var(--ink-soft)]">{entry.label}</p>
              ) : null}
              {entry.changes.length > 0 ? (
                <dl className="mt-2 flex flex-col gap-1.5">
                  {entry.changes.map((change) => (
                    <div key={change.field} className="text-[12.5px] leading-[1.6] break-words">
                      <dt className="inline text-[var(--ink-mute)]">{change.field}: </dt>
                      <dd className="inline text-[var(--ink-soft)]">
                        {change.from} <span aria-hidden="true">→</span>
                        <span className="sr-only">changed to</span>{" "}
                        <span className="text-[var(--ink)]">{change.to}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
