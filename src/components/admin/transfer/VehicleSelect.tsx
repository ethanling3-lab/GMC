"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { capacityOf, VEHICLE_CHOICES } from "@/lib/transfer/vehicles";

// Choose a row's vehicle in place. Saves on pick through the row PATCH route.
// Going over capacity warns rather than blocks, since staff may know better.
// A value outside the list (auto-generated or typed in the row editor) stays
// visible as the current option until someone picks from the list.

export function VehicleSelect({
  listId,
  rowId,
  groupNo,
  vehicle,
  pax,
}: {
  listId: string;
  rowId: string;
  groupNo: number;
  vehicle: string | null;
  pax: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(vehicle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(vehicle ?? ""), [vehicle]);

  const choice = VEHICLE_CHOICES.find((v) => v.type === value);
  const capacity = capacityOf(value);
  const over = capacity !== undefined && pax > capacity;

  async function save(next: string) {
    if (!next || next === value || busy) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/transfer-lists/${listId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicle_type: next }),
      });
      if (!res.ok) throw new Error("save_failed");
      router.refresh();
    } catch {
      setValue(previous);
      setError("Vehicle not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={`Vehicle for group ${groupNo}`}
        value={value}
        disabled={busy}
        onChange={(e) => save(e.target.value)}
        className="w-full min-w-[150px] h-7 px-1.5 rounded-[var(--radius-sm)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 focus-visible:border-[var(--cinnabar)]/50 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none active:border-[var(--cinnabar)] disabled:opacity-60 transition-[border-color,box-shadow]"
      >
        {!choice ? <option value={value}>{value || "Choose a vehicle"}</option> : null}
        {VEHICLE_CHOICES.map((v) => (
          <option key={v.type} value={v.type}>
            {v.type}, fits {v.capacity}
          </option>
        ))}
      </select>
      {over ? (
        <span role="status" className="text-[10.5px] leading-[1.35] font-medium text-[#7A5617]">
          Fits {capacity}, group has {pax}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[10.5px] leading-[1.35] text-[var(--cinnabar-deep)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
