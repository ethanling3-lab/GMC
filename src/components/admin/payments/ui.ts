// Shared control styles for the payments screens (same look as the
// participant detail cards).

export const btn =
  "inline-flex items-center justify-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-40 transition-[border-color,color,transform] duration-[var(--dur-fast)]";

export const primary =
  "inline-flex items-center justify-center h-8 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";

export const input =
  "h-9 w-full px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

export const label = "text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]";

export const panel =
  "rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-5 shadow-[0_1px_2px_rgba(20,40,80,0.04),0_8px_24px_-12px_rgba(20,40,80,0.10)]";

export const stateTone: Record<string, string> = {
  unpaid: "bg-[var(--paper-deep)] text-[var(--ink-soft)]",
  partial: "bg-[var(--gold-soft)] text-[var(--ink)]",
  complete: "bg-[var(--jade-wash)] text-[var(--jade-deep)]",
  behind: "bg-[#FBEAE7] text-[#A8321F]", // overdue: the palette is all blue after the rebrand, so this one warning stays warm,
  cancelled: "bg-[var(--paper-deep)] text-[var(--ink-faint)] line-through",
};

export async function callJson<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(String(j.detail ?? j.error ?? `Request failed (${res.status})`)) as Error & { status: number; body: Record<string, unknown> };
    err.status = res.status;
    err.body = j;
    throw err;
  }
  return j as T;
}
