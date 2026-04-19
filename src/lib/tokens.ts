import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// HMAC-based opaque tokens used for:
//   - Registration confirmation links (/confirm/[token])
//   - Travel info submission links (/travel/[token])
//   - QR codes for check-in
//
// A token is: base64url(random-16-bytes).base64url(hmac-sha256(purpose|payload))
// The random nonce prevents token guessing; the HMAC pins the token to its purpose.

const SECRET = process.env.CONFIRMATION_TOKEN_SECRET;

if (!SECRET && process.env.NODE_ENV !== "test") {
  // Loud fail at module-load time in dev; API routes will error if used without it.
  console.warn("[tokens] CONFIRMATION_TOKEN_SECRET is not set");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(payload: string): Buffer {
  return createHmac("sha256", SECRET || "insecure-dev-secret")
    .update(payload)
    .digest();
}

export type TokenPurpose =
  | "confirm_registration"
  | "travel_submit"
  | "check_in"
  | "register_prefill";

export function createToken(purpose: TokenPurpose, id: string): string {
  const nonce = b64url(randomBytes(16));
  const sig = b64url(hmac(`${purpose}|${id}|${nonce}`));
  return `${nonce}.${sig}`;
}

export function verifyToken(
  purpose: TokenPurpose,
  id: string,
  token: string,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  const expected = b64url(hmac(`${purpose}|${id}|${nonce}`));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Stateless prefill token — binds participant_id + expiry in the HMAC so we
// never have to write a row to the DB. Verifying callers MUST also check the
// expiry is in the future; `verifyPrefillToken` does that for you.
//
// Wire format: `<participantId>~<expiryMs>~<nonce>.<sig>`.
export function createPrefillToken(participantId: string, ttlMs: number): string {
  const expiry = Date.now() + ttlMs;
  const nonce = b64url(randomBytes(12));
  const payload = `${participantId}~${expiry}~${nonce}`;
  const sig = b64url(hmac(`register_prefill|${payload}`));
  return `${payload}.${sig}`;
}

export function verifyPrefillToken(
  token: string,
): { participantId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const [participantId, expiryStr] = payload.split("~");
  if (!participantId || !expiryStr) return null;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = b64url(hmac(`register_prefill|${payload}`));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { participantId };
}

// Stateless payment-access token — binds enrollment_id + expiry in the HMAC,
// so approvals can mint a `/pay/<token>` URL without persisting anything.
// Default TTL is 30 days to cover typical payment windows; callers control it.
export function createPaymentAccessToken(
  enrollmentId: string,
  ttlMs: number,
): string {
  const expiry = Date.now() + ttlMs;
  const nonce = b64url(randomBytes(12));
  const payload = `${enrollmentId}~${expiry}~${nonce}`;
  const sig = b64url(hmac(`payment_access|${payload}`));
  return `${payload}.${sig}`;
}

export function verifyPaymentAccessToken(
  token: string,
): { enrollmentId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const [enrollmentId, expiryStr] = payload.split("~");
  if (!enrollmentId || !expiryStr) return null;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = b64url(hmac(`payment_access|${payload}`));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { enrollmentId };
}
