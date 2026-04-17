import "server-only";
import nodemailer from "nodemailer";

type SendParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

// SMTP is optional during M1. If creds aren't present, we log and return "mocked".
// This lets the registration flow be fully testable without requiring Resend/SMTP first.
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.FROM_EMAIL,
  );
}

export async function sendEmail({ to, subject, html, text }: SendParams): Promise<{ mocked: boolean; id?: string; error?: string }> {
  if (!isEmailConfigured()) {
    console.log(`[email:mock] to=${maskEmail(to)} subject="${subject}"`);
    return { mocked: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `${process.env.FROM_NAME ?? "GMC"} <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      html,
      text: text ?? htmlToText(html),
    });

    return { mocked: false, id: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown email error";
    console.error(`[email:error] ${msg}`);
    return { mocked: false, error: msg };
  }
}

// Masks most of a local part and keeps the domain for log diagnostics without
// leaking the full address into server logs.
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
}
