"use client";

import {
  CUSTOM_HOTEL_PREFIX,
  MAX_HOTEL_NAME,
  customHotelName,
  removedHotelKey,
} from "@/lib/transfer/hotels";

const OTHER = "__other";

// Hotel picker shared by every flight form. "Other hotel" lets staff type the
// exact hotel for a passenger who isn't at one of the event's hotels.
export function HotelSelect({
  value,
  onChange,
  mainVenueName,
  designatedHotels,
  className,
  allowEmpty = false,
}: {
  value: string;
  onChange: (next: string) => void;
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
  className: string;
  allowEmpty?: boolean;
}) {
  const custom = customHotelName(value);
  const removed = removedHotelKey(value, designatedHotels);

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Hotel"
        value={custom !== null ? OTHER : value}
        onChange={(e) =>
          onChange(e.target.value === OTHER ? CUSTOM_HOTEL_PREFIX : e.target.value)
        }
        className={className}
      >
        {allowEmpty ? <option value="">—</option> : null}
        {removed ? <option value={value}>{removed} (removed from event)</option> : null}
        <option value="main_venue">
          {mainVenueName ? `Main · ${mainVenueName}` : "Main venue"}
        </option>
        {Object.entries(designatedHotels).map(([key, name]) => (
          <option key={key} value={`designated:${key}`}>
            Designated · {name}
          </option>
        ))}
        <option value={OTHER}>Other hotel…</option>
      </select>
      {custom !== null ? (
        <input
          aria-label="Hotel name"
          value={custom}
          maxLength={MAX_HOTEL_NAME}
          placeholder="Type the hotel name"
          onChange={(e) => onChange(`${CUSTOM_HOTEL_PREFIX}${e.target.value}`)}
          className={className}
        />
      ) : null}
    </div>
  );
}
