-- Give every participant one canonical, dialable phone number.
--
-- `participants.phone` holds whatever the registrant typed. Five different
-- pieces of code each re-derived a "normalised" form from it at read time, and
-- they disagreed:
--
--   src/lib/broadcasts/audience.ts   toE164              — no country knowledge
--   src/lib/inbox/channels/whatsapp.ts normalizeWhatsAppId — inbound only
--   src/lib/inbox/identity.ts        normalize            — inbound only
--   src/lib/grouping/load-groups.ts  phoneKey             — lossy match key
--   src/app/api/me/recruit/leads/route.ts                 — raw digits
--
-- ...while the actual outbound send path (src/lib/enrollment-notifications.ts)
-- normalised NOTHING and handed `participants.phone` straight to Meta.
--
-- TWO LIVE BUGS THIS CLOSES
--
-- 1. Outbound. A number typed with a trunk prefix or separators reaches Graph
--    verbatim and the send fails. The failure is swallowed by a console.warn
--    in the enrollments route, so approval looks successful while the
--    participant never hears anything on WhatsApp.
--
-- 2. Inbound, and worse. identity.softMatchExistingParticipant resolves an
--    incoming message with `.eq("phone", "+6586111315")`. A participant stored
--    as '+65 86111315' does not match that equality, so the webhook falls
--    through to step 3 and AUTO-CREATES A DUPLICATE lead participant — a
--    second record for someone already registered, with their conversation
--    attached to the wrong one. An exact-match column is the fix; a normalise-
--    on-read helper can't be, because you cannot index it.
--
-- WHY THE BACKFILL IS NOT IN THIS FILE
--
-- The trunk-prefix rules are per-country: '012...' loses its leading zero
-- under +60 but is not a Singapore number at all, and SG/HK have no trunk
-- prefix, so a leading zero there is a data-entry error rather than something
-- to strip. Expressing that in PL/pgSQL would create a SIXTH normaliser to
-- drift out of sync with the other five — exactly the problem being fixed.
--
-- So the backfill runs through the one canonical TypeScript implementation:
--
--   npx tsx scripts/backfill-phone-e164.ts            # dry run + report
--   npx tsx scripts/backfill-phone-e164.ts --apply
--
-- Nothing breaks if it is never run. Every read path normalises on the fly
-- when phone_e164 is null, so this column is an index target and a data-
-- quality surface, not a correctness dependency.

alter table public.participants
  add column if not exists phone_e164 text;

-- Format only. Deliberately NOT a per-country rule: this column also holds
-- numbers from countries GMC has no numbering plan for (participants do
-- register from outside the five regions), and E.164 caps the whole string at
-- 15 digits. Country-level validation lives in src/lib/whatsapp/phone.ts,
-- where it can explain itself to a human.
alter table public.participants
  drop constraint if exists participants_phone_e164_format_ck;
alter table public.participants
  add constraint participants_phone_e164_format_ck
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$') not valid;
alter table public.participants
  validate constraint participants_phone_e164_format_ck;

-- The inbound webhook's hot path — one equality lookup per received message.
-- NOT unique: the census found the same number on more than one participant
-- (duplicate people, created before this column existed). Enforcing
-- uniqueness here would fail the migration on real data, and merging those
-- duplicates is a separate decision with a human in it.
create index if not exists participants_phone_e164_idx
  on public.participants (phone_e164)
  where phone_e164 is not null;

comment on column public.participants.phone_e164 is
  'Canonical E.164 form of `phone` ("+60123456789"), the ONLY value that should ever be handed to Meta Graph or matched against an inbound wa_id. `phone` is kept as the raw typed input: it is the evidence when a send fails, so it is never rewritten in place. Null means the number could not be normalised (no country code and no region to infer one from, or the digits contradict the country claimed) — those rows are listed by scripts/backfill-phone-e164.ts and need a human. Produced only by normalizePhone() in src/lib/whatsapp/phone.ts; do not re-derive it anywhere else.';
