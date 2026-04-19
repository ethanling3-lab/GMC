-- Add arrival_day to events (counterpart to the existing departure_day).
-- Used by the airport transfer list to group arrivals within the 30-min
-- consolidation window, separate from the final-day departure coach.

alter table events
  add column if not exists arrival_day date;
