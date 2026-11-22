"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FlightSnapshot, OpenFlightFlag } from "@/lib/transfer/flight-flags";
import { customHotelName } from "@/lib/transfer/hotels";

// Changes by customer service for an admin to review, and VIP requests for an
// admin to decide. Customer service sees the same list without the buttons.

export type ReviewFlag = OpenFlightFlag & { participant_label: string };

function hotelLabel(
  key: string | null,
  mainVenue: string | null,
  designated: Record<string, string>,
): string {
  if (!key || key === "main_venue") return mainVenue ?? "Main venue";
  const custom = customHotelName(key);
  if (custom !== null) return custom;
  const designatedKey = key.startsWith("designated:") ? key.slice("designated:".length) : key;
  return designated[designatedKey] ?? designatedKey;
}

function describe(
  f: FlightSnapshot | null,
  mainVenue: string | null,
  designated: Record<string, string>,
): string {
  if (!f) return "Removed";
  const when = f.scheduled_at
    ? `${new Date(f.scheduled_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })} ${f.scheduled_at.slice(11, 16)}`
    : "no time";
  const route = `${f.origin_airport ?? "?"} to ${f.destination_airport ?? "?"}`;
  return [
    f.flight_number ?? "No flight number",
    route,
    when,
    f.terminal,
    hotelLabel(f.hotel_key, mainVenue, designated),
  ]
    .filter(Boolean)
    .join(", ");
}

const buttonBase =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] text-[12px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,border-color,color,transform]";

export function FlightFlagsPanel({
  flags,
  canReview,
  mainVenueName,
  designatedHotels,
}: {
  flags: ReviewFlag[];
  canReview: boolean;
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (flags.length === 0) return null;

  async function resolve(id: string, action: "reviewed" | "approve_vip" | "decline_vip") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/flight-flags/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) setError(json.detail ?? json.error ?? "Couldn't save that.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Flight changes for admin review"
      className="rounded-[var(--radius-lg)] border border-[#A87A2A]/40 bg-[#A87A2A]/10 px-5 py-4"
    >
      <h2 className="text-[14px] font-semibold text-[#5F4312]">
        {canReview
          ? `${flags.length} flight ${flags.length === 1 ? "item needs" : "items need"} your review`
          : `${flags.length} flight ${flags.length === 1 ? "item is" : "items are"} waiting for an admin`}
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-[var(--cinnabar-deep)]">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2">
        {flags.map((f) => {
          const direction = f.direction === "arrival" ? "Arrival" : "Departure";
          const headline =
            f.kind === "vip_request"
              ? f.requested_vip
                ? "VIP requested"
                : "VIP removal requested"
              : f.kind === "deleted"
                ? "Flight deleted"
                : "Flight changed";
          return (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 flex-wrap rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 basis-[280px]">
                <div className="text-[13px] text-[var(--ink)]">
                  <strong className="font-semibold">{f.participant_label}</strong>
                  {`: ${headline}, ${direction.toLowerCase()}`}
                </div>
                {f.kind !== "vip_request" ? (
                  <dl className="mt-1 grid grid-cols-[52px_1fr] gap-x-2 text-[12px] leading-[1.5] text-[var(--ink-soft)]">
                    <dt className="text-[var(--ink-faint)]">Was</dt>
                    <dd>{describe(f.before_details, mainVenueName, designatedHotels)}</dd>
                    <dt className="text-[var(--ink-faint)]">Now</dt>
                    <dd>{describe(f.after_details, mainVenueName, designatedHotels)}</dd>
                  </dl>
                ) : null}
                <div className="mt-1 text-[11.5px] text-[var(--ink-mute)]">
                  By {f.requested_by_name ?? "staff"},{" "}
                  {new Date(f.updated_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              {canReview ? (
                <div className="flex items-center gap-2">
                  {f.kind === "vip_request" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => resolve(f.id, "decline_vip")}
                        className={`${buttonBase} border border-[var(--paper-shadow)] text-[var(--ink-soft)] hover:text-[var(--ink)]`}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => resolve(f.id, "approve_vip")}
                        className={`${buttonBase} bg-[var(--cinnabar)] text-[var(--paper)] hover:bg-[var(--cinnabar-deep)]`}
                      >
                        Approve
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => resolve(f.id, "reviewed")}
                      className={`${buttonBase} border border-[var(--paper-shadow)] text-[var(--ink-soft)] hover:text-[var(--ink)]`}
                    >
                      Mark reviewed
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
