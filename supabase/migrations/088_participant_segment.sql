-- Phase 3 · Customer regions (Ethan, 2026-11-26).
-- Each person belongs to one region: 北马 · 南马 · 中马 · 东马 · 新加坡 ·
-- 台湾 · 越南 · 香港 (plus 中国 / 其他 for the rest).
--   • Malaysians: an admin picks 北马 / 中马 / 南马 / 东马 on the profile
--     (Ethan, 2026-11-26 — the admin decides, no state question on forms).
--   • Everyone else: from their country, filled in automatically.
-- Staff can override any of them on the profile.

alter table public.participants
  add column if not exists segment text;

alter table public.participants drop constraint if exists participants_segment_check;
alter table public.participants add constraint participants_segment_check
  check (segment is null or segment in
    ('my_north', 'my_south', 'my_central', 'my_east', 'sg', 'tw', 'vn', 'hk', 'cn', 'other'));

comment on column public.participants.segment is
  'Customer region: my_north/my_south/my_central/my_east (北马/南马/中马/东马), sg, tw, vn, hk, cn, other.';

create index if not exists participants_segment_idx on public.participants (segment);

-- Backfill from country (Malaysians stay empty until an admin picks).
update public.participants
   set segment = case upper(coalesce(region, ''))
                   when 'SG' then 'sg'
                   when 'TW' then 'tw'
                   when 'VN' then 'vn'
                   when 'HK' then 'hk'
                   when 'CN' then 'cn'
                   when 'MY' then null
                   when '' then null
                   else 'other'
                 end
 where segment is null;
