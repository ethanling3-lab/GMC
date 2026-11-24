-- Free-text reason when Motivation · 报名动机 includes 'other' (Ethan,
-- 2026-11-24). Additive. App clears it when 'other' is unticked.

alter table participants
  add column if not exists motivation_other text;

do $$ begin
  alter table participants
    add constraint participants_motivation_other_len
    check (motivation_other is null or char_length(motivation_other) <= 200);
exception when duplicate_object then null; end $$;
