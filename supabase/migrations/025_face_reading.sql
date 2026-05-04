-- 面相 (face-reading) analyzer output, derived from the participant's
-- front photo. Algorithm = client-side face-api.js geometry + skin-tone
-- pixel sampling, classified into one of 10 fixed archetypes
-- (帝王相, 霸王相, 阳孔雀, 工程师, 英雄相, 巫师相, 关系相, 阴孔雀, 会计相, 劳模相).
--
-- We separate the algorithm's suggestion from the admin's confirmed
-- archetype so an edited / filtered photo can be overridden without
-- losing the raw measurement record. Skin tone has its own override
-- because admin sometimes wants to recompute the archetype against a
-- corrected tone without re-running detection.
--
-- The free-text `face_type` column from migration 001 stays in place
-- for Dr Wu's qualitative notes — distinct purpose from the structured
-- archetype landing here.

alter table participants
  add column if not exists face_archetype text,
  add column if not exists face_archetype_suggested text,
  add column if not exists face_measurements jsonb,
  add column if not exists face_skin_tone_override text,
  add column if not exists face_analyzed_at timestamptz,
  add column if not exists face_analysis_error text;

do $$ begin
  alter table participants
    add constraint participants_face_archetype_check
    check (
      face_archetype is null
      or face_archetype in (
        '帝王相','霸王相','阳孔雀','工程师','英雄相',
        '巫师相','关系相','阴孔雀','会计相','劳模相'
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table participants
    add constraint participants_face_archetype_suggested_check
    check (
      face_archetype_suggested is null
      or face_archetype_suggested in (
        '帝王相','霸王相','阳孔雀','工程师','英雄相',
        '巫师相','关系相','阴孔雀','会计相','劳模相'
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table participants
    add constraint participants_face_skin_tone_override_check
    check (
      face_skin_tone_override is null
      or face_skin_tone_override in ('白','黄','糙')
    );
exception when duplicate_object then null; end $$;
