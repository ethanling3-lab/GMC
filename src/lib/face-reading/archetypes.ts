// Ported 1:1 from face_analyzer.html (lines 376–515).
// Pure functions — safe on both server and client.

export const SKIN_TONES = ["白", "黄", "糙"] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

export const WIDTH_TYPES = ["宽", "窄"] as const;
export type WidthType = (typeof WIDTH_TYPES)[number];

export const FOREHEAD_TYPES = ["高", "低"] as const;
export type ForeheadType = (typeof FOREHEAD_TYPES)[number];

export const ARCHETYPE_NAMES = [
  "帝王相",
  "霸王相",
  "阳孔雀",
  "工程师",
  "英雄相",
  "巫师相",
  "关系相",
  "阴孔雀",
  "会计相",
  "劳模相",
] as const;
export type ArchetypeName = (typeof ARCHETYPE_NAMES)[number];

export type Archetype = {
  name: ArchetypeName;
  width: WidthType;
  forehead: ForeheadType;
  skin: SkinTone;
  criteria: string;
  emoji: string;
  tags: readonly string[];
  desc: string;
};

export const ARCHETYPES: Readonly<Record<ArchetypeName, Archetype>> = {
  帝王相: {
    name: "帝王相",
    width: "宽",
    forehead: "高",
    skin: "白",
    criteria: "高额头 + 宽脸 + 白皙",
    emoji: "👑",
    tags: ["宽脸·关注人", "高额头·决策型", "白皙"],
    desc: "领袖气质卓越，决断力极强，善于统筹全局，具有天然权威感与社交驾驭力。通常在管理、领导岗位表现出色。",
  },
  霸王相: {
    name: "霸王相",
    width: "宽",
    forehead: "高",
    skin: "黄",
    criteria: "高额头 + 宽脸 + 黄润",
    emoji: "⚔️",
    tags: ["宽脸·关注人", "高额头·决策型", "黄润"],
    desc: "实干型领导者，行动力强，意志坚定，善于调动人心。在竞争中从不服输，执行力与爆发力俱佳。",
  },
  阳孔雀: {
    name: "阳孔雀",
    width: "窄",
    forehead: "高",
    skin: "白",
    criteria: "高额头 + 窄脸 + 白皙",
    emoji: "🦚",
    tags: ["窄脸·关注事", "高额头·决策型", "白皙"],
    desc: "聪颖睿智，气质优雅，思维超前，追求完美。善于在高层圈子中展现魅力，既有远见又具执行力。",
  },
  工程师: {
    name: "工程师",
    width: "窄",
    forehead: "高",
    skin: "黄",
    criteria: "高额头 + 窄脸 + 黄润",
    emoji: "🔧",
    tags: ["窄脸·关注事", "高额头·决策型", "黄润"],
    desc: "逻辑严谨，注重细节，技术导向，实用主义者。踏实推进每一个目标，是团队中可靠的技术主力。",
  },
  英雄相: {
    name: "英雄相",
    width: "窄",
    forehead: "高",
    skin: "糙",
    criteria: "高额头 + 窄脸 + 偏深",
    emoji: "⚡",
    tags: ["窄脸·关注事", "高额头·决策型", "偏深"],
    desc: "意志顽强，勇于挑战，行动力极强。在逆境中愈战愈勇，天生战士性格，适合需要高压执行力的领域。",
  },
  巫师相: {
    name: "巫师相",
    width: "宽",
    forehead: "低",
    skin: "白",
    criteria: "低额头 + 宽脸 + 白皙",
    emoji: "🔮",
    tags: ["宽脸·关注人", "低额头·谋略型", "白皙"],
    desc: "洞察力超群，直觉敏锐，善于洞悉人心，具有神秘气场与心理操控天赋。擅长幕后运筹帷幄。",
  },
  关系相: {
    name: "关系相",
    width: "宽",
    forehead: "低",
    skin: "黄",
    criteria: "低额头 + 宽脸 + 黄润",
    emoji: "🤝",
    tags: ["宽脸·关注人", "低额头·谋略型", "黄润"],
    desc: "亲和力极强，人缘极好，善于经营人际网络，是天生的联络人与外交家。情感智商（EQ）极高。",
  },
  阴孔雀: {
    name: "阴孔雀",
    width: "窄",
    forehead: "低",
    skin: "白",
    criteria: "低额头 + 窄脸 + 白皙",
    emoji: "🌙",
    tags: ["窄脸·关注事", "低额头·谋略型", "白皙"],
    desc: "内敛细腻，感受力强，具有艺术气质。善于在幕后发挥影响力，优雅从容，审美品位出众。",
  },
  会计相: {
    name: "会计相",
    width: "窄",
    forehead: "低",
    skin: "黄",
    criteria: "低额头 + 窄脸 + 黄润",
    emoji: "📊",
    tags: ["窄脸·关注事", "低额头·谋略型", "黄润"],
    desc: "精细踏实，数字敏感，擅长规划与分析，稳健理财。是团队中可靠的执行者，注重细节与风险控制。",
  },
  劳模相: {
    name: "劳模相",
    width: "窄",
    forehead: "低",
    skin: "糙",
    criteria: "低额头 + 窄脸 + 偏深",
    emoji: "💪",
    tags: ["窄脸·关注事", "低额头·谋略型", "偏深"],
    desc: "勤劳踏实，耐力持久，脚踏实地，不畏辛苦。是任何团队中最可靠的实干家，以行动代替空谈。",
  },
};

export type FaceClassification = {
  faceType: ArchetypeName | "未分类";
  widthLabel: string;
  foreheadLabel: string;
  widthType: WidthType;
  foreheadType: ForeheadType;
  isNarrow: boolean;
  isHighForehead: boolean;
};

// Thresholds calibrated for face-api.js 68-pt landmark measurements.
export const NARROW_THRESHOLD = 1.45;
export const HIGH_FOREHEAD_THRESHOLD = 0.95;

export function classifyFace(
  faceRatio: number,
  foreheadRatio: number,
  skinTone: SkinTone,
): FaceClassification {
  const isNarrow = faceRatio >= NARROW_THRESHOLD;
  const isHighForehead = foreheadRatio >= HIGH_FOREHEAD_THRESHOLD;
  const widthType: WidthType = isNarrow ? "窄" : "宽";
  const foreheadType: ForeheadType = isHighForehead ? "高" : "低";
  const widthLabel = isNarrow ? "窄脸（关注事）" : "宽脸（关注人）";
  const foreheadLabel = isHighForehead
    ? "决策型（高额头）"
    : "谋略型（低额头）";

  let faceType: ArchetypeName | null = null;
  for (const [name, d] of Object.entries(ARCHETYPES) as [
    ArchetypeName,
    Archetype,
  ][]) {
    if (
      d.width === widthType &&
      d.forehead === foreheadType &&
      d.skin === skinTone
    ) {
      faceType = name;
      break;
    }
  }
  if (!faceType) {
    for (const [name, d] of Object.entries(ARCHETYPES) as [
      ArchetypeName,
      Archetype,
    ][]) {
      if (d.width === widthType && d.forehead === foreheadType) {
        faceType = name;
        break;
      }
    }
  }
  return {
    faceType: faceType ?? "未分类",
    widthLabel,
    foreheadLabel,
    widthType,
    foreheadType,
    isNarrow,
    isHighForehead,
  };
}

export function classifySkinTone(r: number, g: number, b: number): SkinTone {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const s =
    max === min
      ? 0
      : l > 0.5
        ? (max - min) / (2 - max - min)
        : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  if (l > 0.7) return "白";
  if (l < 0.42) return "糙";
  if (h >= 12 && h <= 50 && s > 0.12) return "黄";
  if (l >= 0.58) return "白";
  return "黄";
}

export type FaceMeasurements = {
  faceRatio: number;
  foreheadRatio: number;
  faceWidth: number;
  faceHeight: number;
  foreheadH: number;
  lowerFaceH: number;
  skinTone: SkinTone;
  skinRGB: { r: number; g: number; b: number } | null;
  skinCORS: boolean;
  isNarrow: boolean;
  isHighForehead: boolean;
  detPass: string | null;
  corsLimited: boolean;
};

export function isSkinTone(value: unknown): value is SkinTone {
  return typeof value === "string" && (SKIN_TONES as readonly string[]).includes(value);
}

export function isArchetypeName(value: unknown): value is ArchetypeName {
  return (
    typeof value === "string" &&
    (ARCHETYPE_NAMES as readonly string[]).includes(value)
  );
}
