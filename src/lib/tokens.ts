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

export type TokenPurpose = "confirm_registration" | "travel_submit" | "check_in";

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
