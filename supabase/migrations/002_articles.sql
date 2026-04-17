-- M1 marketing site: news / blog articles

create type article_status as enum ('draft', 'published', 'archived');

create table articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_cn text,
  title_en text,
  excerpt_cn text,
  excerpt_en text,
  body_cn text,
  body_en text,
  cover_url text,
  author_name text,
  author_role text,
  tags text[] not null default '{}',
  status article_status not null default 'draft',
  published_at timestamptz,
  created_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index articles_status_idx on articles (status);
create index articles_published_at_idx on articles (published_at desc);

create trigger articles_set_updated_at
  before update on articles
  for each row execute function set_updated_at();

alter table articles enable row level security;

create policy "public can view published articles"
  on articles for select
  to anon
  using (status = 'published' and published_at is not null and published_at <= now());

create policy "admins can view all articles"
  on articles for select
  to authenticated
  using (true);

create policy "super admins manage articles"
  on articles for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- Seed placeholder articles so /news renders during M1 development.
-- Ethan replaces with real content via admin CMS (added M3).
insert into articles (slug, title_cn, title_en, excerpt_cn, excerpt_en, body_cn, body_en, author_name, author_role, tags, status, published_at) values
  (
    'spring-2026-penang-reflections',
    '2026 春 · 槟城修心札记',
    'Spring 2026 · Reflections from Penang',
    '在槟城的七日静修，学员与讲师一同回归经典文本，找回静定之中的判断力。',
    'Seven days of quiet study in Penang — participants and faculty returning to the classics to find judgement from stillness.',
    '### 回到经典\n\n课程从《大学》开篇读起。古人为何说「止于至善」？我们并非要学员背诵条文，而是在每日的饮食、坐行、对话之中，去体会「止」字的分量。\n\n### 一日的节奏\n\n清晨诵读，上午主讲；午后三杯茶，围坐讨论；黄昏再读一段经典。七日下来，学员说：「不是课讲完了，而是生活被重新打开。」',
    '### Return to the Classics\n\nThe programme opened with the Great Learning. Why did the ancients speak of "resting in the highest good"? Our intent was not recitation — it was for each participant to feel the weight of that word, *rest*, inside their eating, walking, speaking, and listening.\n\n### The Rhythm of a Day\n\nMorning chant. A lecture before noon. Three cups of tea at two, and discussion in the round. Another passage at dusk. Seven days in, a participant said: "It isn''t that the course ended — it''s that my life opened back up."',
    'GMC Editorial',
    'Program notes',
    array['retreat', 'penang', 'philosophy'],
    'published',
    now() - interval '6 days'
  ),
  (
    'bgm-youth-cohort-graduation',
    'BGM 少年班 · 2025 秋冬期毕业札记',
    'BGM Youth Development · Autumn 2025 Graduation',
    '十二至十八岁学员在为期半年的课程后，交出各自的「自省书」。',
    'After six months, participants aged 12–18 submit their own self-examination essays.',
    '### 少年的一笔\n\n家长常问：十二岁的孩子真能读懂《论语》吗？我们不强求他们读懂，只要他们愿意抄写、朗读、在饭桌上复述一段，便是开始。毕业时，每位学员交一份「自省书」，写自己在这半年里最想感谢、最想改变、最想守护的事。',
    '### A Young Hand\n\nParents often ask: can a twelve-year-old truly read the Analects? We do not demand comprehension. If they will copy, recite, retell a line at the dinner table — that is the beginning. At graduation each participant submits a "self-examination" — what, over these six months, they most wish to thank, to change, and to hold steady.',
    'GMC Editorial',
    'BGM programme',
    array['bgm', 'youth', 'graduation'],
    'published',
    now() - interval '24 days'
  ),
  (
    'global-collaboration-unesco-ichei',
    '与 UNESCO ICHEI 的合作进展',
    'Progress with UNESCO ICHEI',
    '我们与 UNESCO 高等教育创新中心的合作进入第二阶段，聚焦青年领导力与跨文化对话。',
    'Our collaboration with UNESCO ICHEI enters its second phase, focused on youth leadership and cross-cultural dialogue.',
    '2025 年起，GMC 与 UNESCO ICHEI 联合设立「东方智慧与当代领导力」学者访问计划。首批访问学者来自韩国、法国和马来西亚，共同围绕「经典如何走入现代机构治理」展开讨论。第二阶段扩展到青年领袖群体。',
    'Since 2025, GMC and UNESCO ICHEI have co-founded the "Eastern Wisdom and Contemporary Leadership" visiting scholar programme. The first cohort drew visitors from Korea, France, and Malaysia, each examining how classical texts can enter modern institutional governance. The second phase extends the effort to emerging leaders.',
    'GMC Editorial',
    'Partnerships',
    array['partnerships', 'unesco', 'leadership'],
    'published',
    now() - interval '40 days'
  );
