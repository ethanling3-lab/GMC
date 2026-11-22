// Client-safe types and limits for the WhatsApp setup page.

export const WELCOME_MAX_CHARS = 1024;

export type WhatsAppAutomations = {
  welcome_enabled: boolean;
  welcome_en: string;
  welcome_zh: string;
};
