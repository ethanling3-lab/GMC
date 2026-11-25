-- Add 灵性学习 · Spiritual Learning to growth dimensions (Ethan,
-- 2026-11-24). Used by both participants.goal_dimensions (student goals)
-- and participants.zu_zhang_dimensions (组长 key strengths); grouping
-- matches a student's goals to their leaders' strengths.
alter type growth_dimension add value if not exists 'spiritual';
