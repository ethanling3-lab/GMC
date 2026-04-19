// Types + labels used by both server (page/query) and client (editor/filter)
// components. No `server-only` here — safe to import from client code.

export type EventStatus = "draft" | "open" | "closed" | "archived";
export type EventType = "retreat" | "course" | "workshop" | "seminar" | "other";
export type EventMode = "online" | "offline";

export const STATUS_LABEL: Record<EventStatus, { en: string; zh: string }> = {
  draft: { en: "Draft", zh: "草稿" },
  open: { en: "Open", zh: "开放报名" },
  closed: { en: "Closed", zh: "已截止" },
  archived: { en: "Archived", zh: "归档" },
};

export const TYPE_LABEL: Record<EventType, { en: string; zh: string }> = {
  retreat: { en: "Retreat", zh: "静修" },
  course: { en: "Course", zh: "课程" },
  workshop: { en: "Workshop", zh: "工作坊" },
  seminar: { en: "Seminar", zh: "讲座" },
  other: { en: "Other", zh: "其他" },
};
