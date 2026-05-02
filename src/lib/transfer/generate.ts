// Top-level orchestrator: takes confirmed flight_info rows + per-event
// context and returns ordered transfer groups for the requested direction.
//
// Pure function — no DB access. The route layer is responsible for loading
// inputs (flight_info join enrollments join participants) and persisting
// outputs (transfer_lists + transfer_list_rows).

import { buildArrivals } from "./arrivals";
import { buildDepartures } from "./departures";
import {
  DEFAULT_RULES,
  type EventContext,
  type FlightDirection,
  type FlightRow,
  type GeneratorRules,
  type TransferGroup,
} from "./types";

export type GenerateInput = {
  direction: FlightDirection;
  flights: FlightRow[];
  context: EventContext;
  rules?: Partial<GeneratorRules>;
};

export type GenerateResult = {
  direction: FlightDirection;
  groups: TransferGroup[];
  rules_snapshot: GeneratorRules;
  total_pax: number;
  total_groups: number;
};

export function generateTransferList(input: GenerateInput): GenerateResult {
  // Merge order: defaults → per-event override → caller override.
  // Caller (POST body) wins so a one-off generate can experiment without
  // mutating the event row.
  const rules: GeneratorRules = {
    ...DEFAULT_RULES,
    ...(input.context.rules_override ?? {}),
    ...(input.rules ?? {}),
  };

  const groups =
    input.direction === "arrival"
      ? buildArrivals(input.flights, input.context, rules)
      : buildDepartures(input.flights, input.context, rules);

  const total_pax = groups.reduce((acc, g) => acc + g.passengers.length, 0);

  return {
    direction: input.direction,
    groups,
    rules_snapshot: rules,
    total_pax,
    total_groups: groups.length,
  };
}
