import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

// Changes by customer service that an admin must see, and VIP requests an
// admin must approve. Repeat edits update the one open flag and keep the
// original "before", so the admin compares where it started with where it is.

type Direction = "arrival" | "departure";

export type FlightSnapshot = {
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
};

export type OpenFlightFlag = {
  id: string;
  enrollment_id: string;
  direction: Direction;
  kind: "changed" | "deleted" | "vip_request";
  before_details: FlightSnapshot | null;
  after_details: FlightSnapshot | null;
  requested_vip: boolean | null;
  requested_by_name: string | null;
  updated_at: string;
};

const UNIQUE_VIOLATION = "23505";

export function snapshotOf(f: Record<string, unknown>): FlightSnapshot {
  const text = (k: string) => (f[k] as string | null | undefined) ?? null;
  return {
    flight_number: text("flight_number"),
    airline: text("airline"),
    origin_airport: text("origin_airport"),
    destination_airport: text("destination_airport"),
    scheduled_at: text("scheduled_at"),
    terminal: text("terminal"),
    hotel_key: text("hotel_key"),
    is_vip: Boolean(f.is_vip),
  };
}

export async function recordFlightChange(args: {
  eventId: string;
  enrollmentId: string;
  direction: Direction;
  kind: "changed" | "deleted";
  before: FlightSnapshot;
  after: FlightSnapshot | null;
  actorId: string;
}): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const update = () =>
    service
      .from("flight_change_flags")
      .update({
        kind: args.kind,
        after_details: args.after,
        requested_by: args.actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("enrollment_id", args.enrollmentId)
      .eq("direction", args.direction)
      .is("resolved_at", null)
      .in("kind", ["changed", "deleted"])
      .select("id");

  const first = await update();
  if (first.error) return false;
  if (first.data.length > 0) return true;

  const { error } = await service.from("flight_change_flags").insert({
    event_id: args.eventId,
    enrollment_id: args.enrollmentId,
    direction: args.direction,
    kind: args.kind,
    before_details: args.before,
    after_details: args.after,
    requested_by: args.actorId,
  });
  if (!error) return true;
  if (error.code !== UNIQUE_VIOLATION) return false;
  const retry = await update();
  return !retry.error && retry.data.length > 0;
}

export async function recordVipRequest(args: {
  eventId: string;
  enrollmentId: string;
  direction: Direction;
  requestedVip: boolean;
  actorId: string;
}): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const update = () =>
    service
      .from("flight_change_flags")
      .update({
        requested_vip: args.requestedVip,
        requested_by: args.actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("enrollment_id", args.enrollmentId)
      .eq("direction", args.direction)
      .eq("kind", "vip_request")
      .is("resolved_at", null)
      .select("id");

  const first = await update();
  if (first.error) return false;
  if (first.data.length > 0) return true;

  const { error } = await service.from("flight_change_flags").insert({
    event_id: args.eventId,
    enrollment_id: args.enrollmentId,
    direction: args.direction,
    kind: "vip_request",
    requested_vip: args.requestedVip,
    requested_by: args.actorId,
  });
  if (!error) return true;
  if (error.code !== UNIQUE_VIOLATION) return false;
  const retry = await update();
  return !retry.error && retry.data.length > 0;
}

export async function loadOpenFlightFlags(eventId: string): Promise<OpenFlightFlag[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("flight_change_flags")
    .select(
      "id, enrollment_id, direction, kind, before_details, after_details, requested_vip, requested_by, updated_at",
    )
    .eq("event_id", eventId)
    .is("resolved_at", null)
    .order("updated_at", { ascending: false });
  if (error || !data) return [];

  const adminIds = [
    ...new Set(data.map((f) => f.requested_by).filter((x): x is string => Boolean(x))),
  ];
  const names = new Map<string, string>();
  if (adminIds.length > 0) {
    const { data: admins } = await service
      .from("admins")
      .select("id, name_en, name_cn")
      .in("id", adminIds);
    for (const a of admins ?? []) names.set(a.id, a.name_en || a.name_cn || "Staff");
  }
  return data.map(({ requested_by, ...f }) => ({
    ...(f as Omit<OpenFlightFlag, "requested_by_name">),
    requested_by_name: requested_by ? (names.get(requested_by) ?? "Staff") : null,
  }));
}
