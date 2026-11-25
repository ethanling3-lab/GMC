-- Remove the course catalogue (Ethan, 2026-11-25): "Event = Course" — each
-- event stands alone. Undoes the courses part of 075; the 'planned' status
-- and events.dates_tentative stay. The table is empty (only a QA test
-- course was ever created, and it was deleted).

alter table events drop column if exists course_id;  -- also drops events_course_id_idx
drop table if exists courses;
