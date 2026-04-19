-- Add soft-delete (archive) to participants.
-- NULL = active, timestamp = archived at that moment.
-- Default list views filter out rows where archived_at is not null.

alter table participants
  add column if not exists archived_at timestamptz;

-- Partial index speeds up "not archived" reads — the dominant query shape.
create index if not exists participants_archived_at_idx
  on participants (archived_at)
  where archived_at is null;
