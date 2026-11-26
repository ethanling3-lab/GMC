-- Student status filter on the Participants list (Ethan, 2026-11-26).
-- 老学员 vs 新人 depends on "has this person ever checked in at an event",
-- the same evidence pricing uses. A flag on the participant lets the list
-- filter on it directly; triggers keep it in step with check_ins.

alter table public.participants
  add column if not exists has_checked_in boolean not null default false;

comment on column public.participants.has_checked_in is
  'True once the person has any check-in (check_ins). Kept by triggers; used by the Student status filter.';

update public.participants p
   set has_checked_in = true
 where not p.has_checked_in
   and exists (select 1 from public.check_ins c where c.participant_id = p.id);

create or replace function public.check_ins_mark_participant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.participant_id is not null then
    update public.participants set has_checked_in = true
     where id = new.participant_id and not has_checked_in;
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.participant_id is not null
     and (tg_op = 'DELETE' or old.participant_id is distinct from new.participant_id) then
    update public.participants p
       set has_checked_in = exists (select 1 from public.check_ins c where c.participant_id = p.id)
     where p.id = old.participant_id;
  end if;
  return null;
end $$;

drop trigger if exists check_ins_mark_participant on public.check_ins;
create trigger check_ins_mark_participant
  after insert or update of participant_id or delete on public.check_ins
  for each row execute function public.check_ins_mark_participant();
