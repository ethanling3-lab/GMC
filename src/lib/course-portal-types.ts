// Shared types for the learner course portal (Phase 1). This file is
// deliberately free of "server-only" so client components (the tab UI, the
// submission form) can import the types without pulling in the service-role
// client. Loaders live in course-portal.ts (server-only).

export type CourseAssignmentKind = "homework" | "report";
export type CourseSubmissionType = "file" | "text" | "both";
export type CourseSubmissionStatus = "draft" | "submitted";

export type SubmissionFileView = {
  id: string;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
};

export type MySubmissionView = {
  id: string;
  status: CourseSubmissionStatus;
  text_body: string | null;
  submitted_at: string | null;
  files: SubmissionFileView[];
};

export type CourseAssignmentView = {
  id: string;
  title_en: string | null;
  title_cn: string | null;
  description_en: string | null;
  description_cn: string | null;
  kind: CourseAssignmentKind;
  submission_type: CourseSubmissionType;
  due_at: string | null;
  mine: MySubmissionView | null;
};

export type CourseRecordingView = {
  id: string;
  title_en: string | null;
  title_cn: string | null;
  duration_seconds: number | null;
};

export type CourseCard = {
  event_id: string;
  slug: string;
  title_en: string | null;
  title_cn: string | null;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  poster_url: string | null;
  enrollment_status: string;
  payment_status: string;
  assignment_count: number;
  submitted_count: number;
  recording_count: number;
};

export type CourseDetail = {
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    start_date: string | null;
    end_date: string | null;
    venue: string | null;
    poster_url: string | null;
    body_en: string | null;
    body_cn: string | null;
  };
  assignments: CourseAssignmentView[];
  recordings: CourseRecordingView[];
};

// File-upload allow-list, mirrored from the course-submissions bucket in
// migration 046. Kept here so the client file picker and the server upload-url
// route agree on one source of truth.
export const SUBMISSION_ACCEPT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip",
] as const;

export const SUBMISSION_MAX_BYTES = 52428800; // 50 MB, matches the bucket cap
