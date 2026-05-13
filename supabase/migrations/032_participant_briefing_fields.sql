-- M6.8 follow-up — full briefing-card field set on participants.
--
-- Drives the per-participant profile deck (Dr Wu's 学员名册 layout).
-- All fields are admin/CS-maintained — filled at registration when the
-- form_schema asks the corresponding question, OR backfilled manually by
-- the CS team after they get to know the participant. Nothing in here is
-- consumed by the grouping algorithm.
--
-- Schema-by-section (mirrors the three grey banner zones on the card):
--
--   ── 个人信息 · Personal Info (extends what's already in IdentityEditor):
--      sub_region              — geographic sub-zone within country, e.g.
--                                "北马" / "中马" / "南马" / "新加坡北部".
--      training_level          — GMC training progress chip: 初训 / 复训 /
--                                进阶. Distinct from is_old_student (which
--                                only tracks new-vs-returning binary).
--      health_status           — free text: 健康 / 亚健康 / 调理中 / 等等
--      family_situation        — free text describing family context
--
--   ── 上课信息 · Class Info (per-participant defaults; per-event meal
--                              preferences can still live on the enrollment):
--      class_language_preference — 中文 / 英文 / 中英文 (preferred class lang)
--      dietary_needs             — 荤食 / 素食 / 半素 / 等等
--
--   ── 客服 / 介绍人建议 · CS / Referrer Recommendations:
--      interaction_notes       — 注意事项 — how the CS team should approach
--      course_needs            — 上课的需求点 — why they're here, what
--                                problems they want to solve
--      suggested_group_leader_notes — 建议在谁的小组 (free text)
--      recommended_courses     — 引导报名什么课程 (free text)
--      forbidden_courses       — 不能报名什么课程 (free text)
--      cs_evaluation           — 备注 / 客服评价 — public briefing remark
--                                (distinct from cs_notes, which stays
--                                admin-internal)

alter table public.participants
  add column if not exists sub_region text,
  add column if not exists training_level text,
  add column if not exists health_status text,
  add column if not exists family_situation text,
  add column if not exists class_language_preference text,
  add column if not exists dietary_needs text,
  add column if not exists interaction_notes text,
  add column if not exists course_needs text,
  add column if not exists suggested_group_leader_notes text,
  add column if not exists recommended_courses text,
  add column if not exists forbidden_courses text,
  add column if not exists cs_evaluation text;

comment on column public.participants.sub_region is
  'Geographic sub-zone within country (e.g. 北马 / 中马 / 南马). Free text.';
comment on column public.participants.training_level is
  'GMC training progress label (初训 / 复训 / 进阶). Free text — distinct from is_old_student which is binary.';
comment on column public.participants.health_status is
  'Free text health condition (健康 / 亚健康 / 调理中).';
comment on column public.participants.family_situation is
  'Free text describing family context (marital, kids, dependents).';
comment on column public.participants.class_language_preference is
  'Preferred class language (中文 / 英文 / 中英文). Per-participant; distinct from language_fluency.';
comment on column public.participants.dietary_needs is
  'Dietary requirement (荤食 / 素食 / 半素).';
comment on column public.participants.interaction_notes is
  '注意事项 — how the CS team should approach this person.';
comment on column public.participants.course_needs is
  '上课的需求点 — why they''re here, what they want from the course. Renders prominently on the profile deck.';
comment on column public.participants.suggested_group_leader_notes is
  '建议在谁的小组 — referrer/CS suggestion for which 组长 this person fits with.';
comment on column public.participants.recommended_courses is
  '引导报名什么课程 — paid courses this person should be guided toward.';
comment on column public.participants.forbidden_courses is
  '不能报名什么课程 — paid courses this person should NOT be steered toward.';
comment on column public.participants.cs_evaluation is
  '备注 / 客服评价 — public briefing remark visible on the profile deck. Distinct from cs_notes (which stays admin-internal).';
