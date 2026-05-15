-- M7.1c — Face-recognition check-in.
--
-- Replaces QR scanning at the door with face-match against a per-event
-- bank of 128-dim embeddings derived from each participant's
-- `front_photo_url`. Embeddings are computed client-side via face-api.js
-- (already a dep) and stored as JSONB so we can avoid the pgvector
-- extension at 500-pax scale.
--
-- Privacy-by-design: extraction + matching only ever run for
-- participants who explicitly opted in via the registration form. The
-- column defaults to FALSE so legacy rows stay opted out.

alter table public.participants
  add column if not exists facial_recognition_consent boolean not null default false,
  add column if not exists face_embedding jsonb,
  add column if not exists face_embedding_at timestamptz,
  add column if not exists face_embedding_error text;

-- Partial index — only opted-in + extracted rows. Keeps the bank loader
-- fast even after the participants table grows past several thousand
-- legacy rows whose embeddings we never compute.
create index if not exists participants_face_embedding_idx
  on public.participants (id)
  where facial_recognition_consent = true and face_embedding is not null;

-- Extend the check-in method enum from migration 034 with `face_match`.
-- Idempotency-guarded via the duplicate_object exception block.
do $$
begin
  alter type public.check_in_method add value if not exists 'face_match';
exception when duplicate_object then null;
end $$;
