-- M6.8 — profile-deck fields on participants.
--
-- Three new columns to power the per-participant briefing slides
-- (Dr Wu's pre-event "学员名册" layout):
--
--   dharma_name      法名   text (free-form, often empty)
--   religion         宗教   text (free-form: 佛教 / 基督教 / 道教 / 无宗教 / ...
--                                  kept as text rather than enum to absorb
--                                  spelling variations + bilingual entries)
--   attended_courses 曾参加课程 jsonb array
--                                 [{ course_name, programme_tier?, date? }]
--                                 Admin maintains by hand on the participant
--                                 detail page; algorithm doesn't read it.
--
-- programme_subtier (共/不共) intentionally NOT added — deferred until
-- Dr Wu pushes back on a v1 deck without it.

alter table public.participants
  add column if not exists dharma_name text,
  add column if not exists religion text,
  add column if not exists attended_courses jsonb not null default '[]'::jsonb;

-- Light shape guard: attended_courses must be an array. We don't deeper-
-- validate per-element shape in SQL (jsonb is too forgiving for that to
-- be worth it); the zod schema enforces shape at the write boundary.
do $$ begin
  alter table public.participants
    add constraint participants_attended_courses_is_array
    check (jsonb_typeof(attended_courses) = 'array');
exception when duplicate_object then null; end $$;

comment on column public.participants.dharma_name is
  'Optional dharma name (法名). Free-form text. Renders on profile-deck slides.';
comment on column public.participants.religion is
  'Free-form religion label (宗教). Renders on profile-deck slides.';
comment on column public.participants.attended_courses is
  'jsonb array of past course attendance. Shape: [{ course_name, programme_tier?, date? }]. Admin-maintained; not consumed by the grouping algorithm.';
