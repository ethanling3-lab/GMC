import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// HitPay client + webhook verifier. Wraps the v1 payment-requests endpoint.
//
// Two-mode: when HITPAY_API_KEY is set, real HTTP calls fly to either the
// sandbox or production base URL (via HITPAY_ENV). When the key is absent we
// degrade to a mocked checkout — same return shape, a pseudo URL — so local
// dev (or staging without HitPay creds) doesn't error out. Callers shouldn't
// branch on the env; just await the helper.

const SANDBOX_BASE = "https://api.sandbox.hit-pay.com/v1";
const PRODUCTION_BASE = "https://api.hit-pay.com/v1";

function envBaseUrl(): string {
  const env = (process.env.HITPAY_ENV ?? "").toLowerCase();
  if (env === "production" || env === "prod" || env === "live") {
    return PRODUCTION_BASE;
  }
  return SANDBOX_BASE;
}

function isMocked(): boolean {
  return !process.env.HITPAY_API_KEY;
}

export type CreatePaymentRequestInput = {
  amount: number;
  currency: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  reference_number: string;
  redirect_url: string;
  webhook: string;
  /** Free-text description shown on the HitPay receipt + admin dashboard. */
  purpose?: string;
};

export type CreatePaymentRequestResult = {
  /** HitPay's payment-request id. Persist as enrollments.payment_provider_id. */
  id: string;
  /** Hosted checkout URL — redirect the participant here. */
  url: string;
  status: string;
  mocked: boolean;
};

export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<CreatePaymentRequestResult> {
  if (isMocked()) {
    const fakeId = `mock_${Date.now().toString(36)}`;
    return {
      id: fakeId,
      url: `${input.redirect_url}${input.redirect_url.includes("?") ? "&" : "?"}mock_hitpay=${fakeId}`,
      status: "pending",
      mocked: true,
    };
  }

  // HitPay's payment-requests endpoint accepts application/x-www-form-urlencoded.
  // Include `redirect_url` + `webhook` so the participant ends up back on /pay
  // and our webhook fires from HitPay's side independently of redirect.
  const body = new URLSearchParams();
  body.set("amount", input.amount.toFixed(2));
  body.set("currency", input.currency.toUpperCase());
  body.set("reference_number", input.reference_number);
  body.set("redirect_url", input.redirect_url);
  body.set("webhook", input.webhook);
  body.set("send_email", "false"); // We send our own bilingual receipt.
  body.set("send_sms", "false");
  if (input.email) body.set("email", input.email);
  if (input.name) body.set("name", input.name);
  if (input.phone) body.set("phone", input.phone);
  if (input.purpose) body.set("purpose", input.purpose);

  const res = await fetch(`${envBaseUrl()}/payment-requests`, {
    method: "POST",
    headers: {
      "X-BUSINESS-API-KEY": process.env.HITPAY_API_KEY ?? "",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // HitPay returns plain text on some 4xx — surface in the error.
  }
  if (!res.ok) {
    const detail =
      typeof payload === "object" &&
      payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : text || `${res.status}`;
    throw new Error(`hitpay_create_failed: ${detail}`);
  }

  const id = String((payload as { id?: unknown }).id ?? "");
  const url = String((payload as { url?: unknown }).url ?? "");
  const status = String((payload as { status?: unknown }).status ?? "pending");
  if (!id || !url) {
    throw new Error(`hitpay_unexpected_response: ${text.slice(0, 200)}`);
  }
  return { id, url, status, mocked: false };
}

/**
 * Verifies the HitPay webhook payload. HitPay computes HMAC-SHA256 over the
 * concatenation of all `field=value` pairs (alphabetical, excluding `hmac`),
 * keyed by `HITPAY_SALT`. The `hmac` field in the form body must match.
 *
 * Pass the parsed form payload (as Record<string, string>) and the value of
 * the `hmac` field. Returns true when the signature is valid; false otherwise.
 */
export function verifyWebhookHmac(
  payload: Record<string, string>,
  providedHmac: string,
): boolean {
  const salt =
    process.env.HITPAY_SALT ?? process.env.HITPAY_WEBHOOK_SECRET ?? "";
  if (!salt) {
    // No secret configured — treat as fail-closed unless we're explicitly mocked.
    return false;
  }
  const sortedKeys = Object.keys(payload)
    .filter((k) => k !== "hmac")
    .sort();
  const message = sortedKeys.map((k) => `${k}${payload[k]}`).join("");
  const expected = createHmac("sha256", salt).update(message).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(providedHmac, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Convenience type that mirrors HitPay's webhook payload shape. */
export type HitPayWebhookPayload = {
  payment_id: string;
  payment_request_id: string;
  amount: string;
  currency: string;
  status: string;
  reference_number?: string;
  hmac: string;
  // Plus other fields HitPay sends (phone, email, etc.) — we don't rely on
  // them, but they're included in the HMAC computation.
};

/** Pulls the canonical fields out of a parsed HitPay webhook body. */
export function extractWebhookFields(
  payload: Record<string, string>,
): HitPayWebhookPayload | null {
  const required: (keyof HitPayWebhookPayload)[] = [
    "payment_id",
    "payment_request_id",
    "amount",
    "currency",
    "status",
    "hmac",
  ];
  for (const k of required) {
    if (typeof payload[k] !== "string" || payload[k].length === 0) return null;
  }
  return {
    payment_id: payload.payment_id,
    payment_request_id: payload.payment_request_id,
    amount: payload.amount,
    currency: payload.currency,
    status: payload.status,
    reference_number: payload.reference_number,
    hmac: payload.hmac,
  };
}
