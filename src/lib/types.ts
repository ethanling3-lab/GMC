export type Locale = "zh" | "en";

export type AdminRole =
  | "super_admin"
  | "regional_lead"
  | "customer_service"
  | "finance"
  | "instructor";

export type ParticipantStatus =
  | "new"
  | "info_verified"
  | "cs_enriched"
  | "active"
  | "inactive";

export type MotivationTag =
  | "clean"
  | "insurance"
  | "direct_sales"
  | "spiritual"
  | "other";

export type EventType = "retreat" | "course" | "workshop" | "seminar" | "other";
export type EventMode = "online" | "offline";
export type EventStatus = "draft" | "open" | "closed" | "archived";

export type EnrollmentStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid"
  | "cancelled";

export type PaymentMethod = "hitpay" | "stripe" | "bank_transfer" | "tt";
export type PaymentStatus =
  | "none"
  | "pending"
  | "paid"
  | "failed"
  | "refunded";

export type NotificationChannel = "whatsapp" | "email" | "sms";
export type NotificationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export interface Participant {
  id: string;
  region_id: string;
  name_cn: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language: Locale | "both" | null;
  gender: string | null;
  birth_date: string | null;
  occupation: string | null;
  industry: string | null;
  financial_score: number | null;
  influence_score: number | null;
  overall_score: number | null;
  motivation_tag: MotivationTag | null;
  is_old_student: boolean;
  family_of_participant_id: string | null;
  referrer_id: string | null;
  personality: string | null;
  face_type: string | null;
  parameter_framework: string | null;
  front_photo_url: string | null;
  assigned_region_lead_id: string | null;
  assigned_cs_id: string | null;
  cs_notes: string | null;
  status: ParticipantStatus;
  created_at: string;
  updated_at: string;
}

export interface EventRecord {
  id: string;
  slug: string;
  title_cn: string | null;
  title_en: string | null;
  heading_cn: string | null;
  heading_en: string | null;
  sub_heading_cn: string | null;
  sub_heading_en: string | null;
  body_cn: string | null;
  body_en: string | null;
  poster_url: string | null;
  gallery: string[];
  type: EventType;
  mode: EventMode;
  venue: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  departure_day: string | null;
  enrollment_opens_at: string | null;
  enrollment_closes_at: string | null;
  capacity: number | null;
  price: number | null;
  currency: string;
  payment_methods: PaymentMethod[];
  target_audience_filter: Record<string, unknown>;
  status: EventStatus;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: string;
  participant_id: string;
  event_id: string;
  status: EnrollmentStatus;
  approved_by: string | null;
  approved_at: string | null;
  payment_method: PaymentMethod | null;
  payment_provider_id: string | null;
  payment_status: PaymentStatus;
  amount_paid: number | null;
  paid_at: string | null;
  cs_followup_notes: string | null;
  qr_token: string | null;
  confirmation_token: string | null;
  confirmation_token_expires_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}
