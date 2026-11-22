// Client-safe types and limits for the WhatsApp setup page.

export const WELCOME_MAX_CHARS = 1024;
export const FAQ_QUESTION_MAX_CHARS = 300;
export const FAQ_ANSWER_MAX_CHARS = 1500;
export const FOLLOWUP_DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14] as const;

export type WhatsAppAutomations = {
  welcome_enabled: boolean;
  welcome_en: string;
  welcome_zh: string;
  faqs_enabled: boolean;
  followup_enabled: boolean;
  followup_after_days: number;
  followup_enabled_at: string | null;
};

export type WhatsAppFaq = {
  id: string;
  question: string;
  answer_en: string | null;
  answer_zh: string | null;
};
