-- Language groups (Ethan, 2026-11-24). English listeners sit in an
-- English group, Vietnamese in a Vietnamese group, each led by a 组长 who
-- speaks that language.
--
--   listening_language — the language the participant listens to the
--                        class in (zh 中文, en English, vi Tiếng Việt, …)
--   spoken_languages   — languages they can speak; for 组长 this decides
--                        which language groups they can lead
--
-- Universal: any language code works. Grouping ties whoever listens in a
-- language to a 组长 who speaks it. The list of choices lives in
-- src/lib/participants/languages.ts — adding a language there needs no
-- migration. The DB only checks the code's shape.
--
-- language_fluency (cn/en/both) stays as the COMMUNICATION language for
-- emails / WhatsApp / inbox / briefing deck — untouched.

alter table participants
  add column if not exists listening_language text not null default 'zh',
  add column if not exists spoken_languages text[] not null default '{zh}';

alter table participants
  drop constraint if exists participants_listening_language_check;
alter table participants
  add constraint participants_listening_language_check
  check (listening_language ~ '^[a-z]{2,3}$');

alter table participants
  drop constraint if exists participants_spoken_languages_check;
alter table participants
  add constraint participants_spoken_languages_check
  check (array_position(spoken_languages, null) is null
         and array_to_string(spoken_languages, ',') ~ '^([a-z]{2,3}(,[a-z]{2,3})*)?$');

-- Backfill from language_fluency: cn → 中文, en → English,
-- both → listens 中文, speaks 中文 + English.
update participants set
  listening_language = case language_fluency::text when 'en' then 'en' else 'zh' end,
  spoken_languages = case language_fluency::text
    when 'en' then array['en']
    when 'both' then array['zh', 'en']
    else array['zh']
  end
where language_fluency is not null;

create index if not exists participants_listening_language_idx
  on participants (listening_language);

-- New participants (register, staff create, CSV import, inbox) get the
-- same derivation on insert, unless the insert set the class languages
-- explicitly (anything other than the column defaults).
create or replace function participants_default_class_languages()
returns trigger language plpgsql as $$
begin
  if new.language_fluency is not null
     and new.listening_language = 'zh'
     and new.spoken_languages = array['zh']::text[] then
    new.listening_language := case new.language_fluency::text when 'en' then 'en' else 'zh' end;
    new.spoken_languages := case new.language_fluency::text
      when 'en' then array['en']
      when 'both' then array['zh', 'en']
      else array['zh']
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists participants_default_class_languages on participants;
create trigger participants_default_class_languages
  before insert on participants
  for each row execute function participants_default_class_languages();
