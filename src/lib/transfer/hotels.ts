// Hotel values stored in flight_info.hotel_key:
//   main_venue | designated:<key> | custom:<hotel name typed by staff>
// Pure, safe for client imports.

export const CUSTOM_HOTEL_PREFIX = "custom:";
export const MAX_HOTEL_NAME = 200;

export function customHotelName(key: string | null | undefined): string | null {
  if (!key?.startsWith(CUSTOM_HOTEL_PREFIX)) return null;
  return key.slice(CUSTOM_HOTEL_PREFIX.length);
}

// A designated hotel that has since been removed from the event.
export function removedHotelKey(
  key: string | null | undefined,
  designatedHotels: Record<string, string>,
): string | null {
  if (!key?.startsWith("designated:")) return null;
  const id = key.slice("designated:".length);
  return designatedHotels[id] ? null : id;
}
