-- Seed each programme's course list from the 2026 brochures
-- (brand_assets/Brochures/*2026.pdf). Run AFTER 079. Safe to re-run:
-- existing course names and links are left alone.
--
-- Reading rules (to confirm with Yi Suan):
--   • 进阶 / 高阶 (advanced) versions and HLCC level variants are separate
--     courses, because the brochures name them differently.
--   • 《永不落空》 (文化财 brochures) = 永不落空的力量 (丰盛/荣贵 brochures).
--   • 金口之道：语言创造财富的力量 (文化财) = 金口之道 with that subtitle (丰盛).
--   • 私塾答疑解惑 (精英) = 答疑解惑（线下/线上）(荣贵).

-- 1. Course names (shared across programmes)
insert into courses (name_cn, name_en, subtitle_cn, subtitle_en) values
  ('永不落空的力量', 'Infallible Power', null, null),
  ('大有门道', 'The Great Way', null, null),
  ('金口之道', 'Golden Speech', '语言创造财富的力量', 'The Power of Words to Create Wealth'),
  ('预见未来·财富真谛', 'Foreseeing the Future · The Truth of Wealth', null, null),
  ('匠心雕龙', 'Sculpting a Flawless Heart', null, null),
  ('修身齐家篇', 'The Chapter of Self-cultivation and Family Regulation', null, null),
  ('HLCC 赚健康（第一阶）', 'Earn Your Health – Healthy Lifestyle Course (Level 1)', null, null),
  ('金口之道（进阶）', 'Golden Speech (Advanced)', '语言创造财富的力量', 'The Power of Words to Create Wealth'),
  ('伟大创新（进阶）', 'Great Innovation (Advanced)', '超越识境的颠覆创新', 'Disruptive Innovation Beyond Perception'),
  ('黄金尺（进阶）', 'The Golden Measure (Advanced)', '不变的商业准则', 'Immutable Business Principles'),
  ('匠心雕龙（进阶）', 'Sculpting a Flawless Heart (Advanced)', null, null),
  ('生财有大道（进阶）', 'The Path of Great Learning (Advanced)', null, null),
  ('HLCC 赚健康（第一、二阶）', 'Earn Your Health – Healthy Lifestyle Course (Level 1, Level 2)', null, null),
  ('化性修身·健康营', 'Transforming Habits and Self Cultivation Health Camp', '心性提升与健康生活的变革', 'Uplifting the Mind and Transforming to Healthy Living'),
  ('答疑解惑（线下/线上）', 'Q&A and Clarification (Offline / Online)', null, null),
  ('黄金尺', 'The Golden Measure', null, null),
  ('伟大创新（高阶）', 'Great Innovation (Advanced)', null, null),
  ('化性禅', 'Meditation for Transforming Habits', null, null),
  ('人文哲学 × 商业策略', 'Philosophy of Humanities × Business Strategy', null, null),
  ('回到经典，理解格局、战略与人性', 'Return to the classics to gain insight into vision, strategy, and human nature', null, null),
  ('金刚智慧｜管理心经', 'Diamond Wisdom | The Essence of Management', '企业革新破局之道', 'A Path to Business Innovation and Breakthroughs'),
  ('大商人维摩诘', 'The Great Merchant Vimalakirti', '不可思议的商业策略', 'Incredible Business Strategies'),
  ('老子哲学', 'Laozi Philosophy', '黄金商业法则', 'Golden Business Rules'),
  ('孙子兵法', 'The Art of War by Sun Tzu', '终极商业竞争', 'Ultimate Competition in Business'),
  ('儒家经典', 'Confucian Classics', null, null),
  ('成事不二门', 'Accomplishment Through the Nonduality Gate', '识境超越与颠覆性创新', 'Transcending Consciousness and Driving Disruptive Innovation'),
  ('洞察与布局', 'Insight and Strategic Design', '现代商业决策艺术', 'The Art of Modern Business Decision-Making')
on conflict (name_cn) do nothing;

-- 2. Which programme includes which course, by section, in brochure order
with links (programme_slug, section_cn, section_en, sort_order, course_cn) as (
  values
  -- 丰盛篇 Abundance
  ('abundance', '入门课–核心课程', 'Introductory Courses – Core Courses', 10, '永不落空的力量'),
  ('abundance', '入门课–核心课程', 'Introductory Courses – Core Courses', 20, '大有门道'),
  ('abundance', '必修课–财富通途课程', 'Compulsory Courses – The Path to Wealth', 30, '金口之道'),
  ('abundance', '必修课–财富通途课程', 'Compulsory Courses – The Path to Wealth', 40, '预见未来·财富真谛'),
  ('abundance', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 50, '匠心雕龙'),
  ('abundance', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 60, '修身齐家篇'),
  ('abundance', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 70, 'HLCC 赚健康（第一阶）'),
  -- 荣贵家族 Glorious Family
  ('glorious_family', '入门课–核心课程', 'Introductory Courses – Core Courses', 10, '永不落空的力量'),
  ('glorious_family', '入门课–核心课程', 'Introductory Courses – Core Courses', 20, '大有门道'),
  ('glorious_family', '必修课–财富通途课程', 'Compulsory Courses – The Path to Wealth', 30, '金口之道（进阶）'),
  ('glorious_family', '必修课–财富通途课程', 'Compulsory Courses – The Path to Wealth', 40, '伟大创新（进阶）'),
  ('glorious_family', '必修课–财富通途课程', 'Compulsory Courses – The Path to Wealth', 50, '黄金尺（进阶）'),
  ('glorious_family', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 60, '匠心雕龙（进阶）'),
  ('glorious_family', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 70, '生财有大道（进阶）'),
  ('glorious_family', '专题课–幸福经营课程', 'Specialised Courses – Happiness Management', 80, 'HLCC 赚健康（第一、二阶）'),
  ('glorious_family', '游学参访', 'Study Tour', 90, '化性修身·健康营'),
  ('glorious_family', '私塾课', 'Private Course', 100, '答疑解惑（线下/线上）'),
  -- 精英文化财 Elite Cultural Heritage
  ('elite_cultural_heritage', '基础课程', 'Foundation Course', 10, '永不落空的力量'),
  ('elite_cultural_heritage', '基础课程', 'Foundation Course', 20, '大有门道'),
  ('elite_cultural_heritage', '必修课程', 'Compulsory Courses', 30, '金口之道'),
  ('elite_cultural_heritage', '必修课程', 'Compulsory Courses', 40, '黄金尺'),
  ('elite_cultural_heritage', '必修课程', 'Compulsory Courses', 50, '伟大创新（高阶）'),
  ('elite_cultural_heritage', '专题课', 'Specialised Courses', 60, 'HLCC 赚健康（第一、二阶）'),
  ('elite_cultural_heritage', '游学参访', 'Study Tour', 70, '化性禅'),
  ('elite_cultural_heritage', '游学参访', 'Study Tour', 80, '匠心雕龙'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 90, '人文哲学 × 商业策略'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 100, '金刚智慧｜管理心经'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 110, '大商人维摩诘'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 120, '老子哲学'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 130, '孙子兵法'),
  ('elite_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 140, '儒家经典'),
  ('elite_cultural_heritage', '私塾课', 'Private Course', 150, '答疑解惑（线下/线上）'),
  -- 荣耀文化财 Glorious Cultural Heritage
  ('glorious_cultural_heritage', '基础课程', 'Foundation Course', 10, '永不落空的力量'),
  ('glorious_cultural_heritage', '基础课程', 'Foundation Course', 20, '大有门道'),
  ('glorious_cultural_heritage', '必修课程', 'Compulsory Courses', 30, '金口之道'),
  ('glorious_cultural_heritage', '必修课程', 'Compulsory Courses', 40, '黄金尺'),
  ('glorious_cultural_heritage', '必修课程', 'Compulsory Courses', 50, '伟大创新（高阶）'),
  ('glorious_cultural_heritage', '专题课', 'Specialised Courses', 60, 'HLCC 赚健康（第一、二阶）'),
  ('glorious_cultural_heritage', '游学参访', 'Study Tour', 70, '匠心雕龙'),
  ('glorious_cultural_heritage', '游学参访', 'Study Tour', 80, '化性禅'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 90, '回到经典，理解格局、战略与人性'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 100, '金刚智慧｜管理心经'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 110, '大商人维摩诘'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 120, '老子哲学'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 130, '孙子兵法'),
  ('glorious_cultural_heritage', '人文哲学经典课程', 'Philosophy of Humanities Classic Program', 140, '儒家经典'),
  ('glorious_cultural_heritage', '荣耀私塾课', 'Glorious Private Course', 150, '成事不二门'),
  ('glorious_cultural_heritage', '荣耀私塾课', 'Glorious Private Course', 160, '洞察与布局')
)
insert into programme_courses (programme_id, course_id, section_cn, section_en, sort_order)
select p.id, c.id, l.section_cn, l.section_en, l.sort_order
from links l
join programmes p on p.slug = l.programme_slug
join courses c on c.name_cn = l.course_cn
on conflict (programme_id, course_id) do nothing;
