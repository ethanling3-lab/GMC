import "server-only";
import { createSign } from "node:crypto";

// Google service-account auth.
//
// We talk to Drive (create files) + Sheets (write tabs) via direct REST calls
// — small surface, avoids pulling in `googleapis` (~6 MB). The JWT bearer
// flow is documented at https://developers.google.com/identity/protocols/oauth2/service-account
//
// Required env:
//   GMC_GOOGLE_SERVICE_ACCOUNT_JSON
//     Either raw JSON or base64-encoded JSON of the service account key.
//     The base64 path is recommended for Netlify since multi-line values
//     get mangled. See https://cloud.google.com/iam/docs/keys-create-delete
//   GMC_PARENT_DRIVE_FOLDER_ID (optional)
//     Drive folder id where new event sheets are created. Share that
//     folder with the service account's client_email + each admin.
//     If unset, sheets land in the service account's "My Drive" — only the
//     service account itself sees them in Drive UI; admins must use the
//     direct webViewLink we store on events.transfer_sheet_url.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

type ServiceAccountKey = {
  type: string;
  client_email: string;
  private_key: string;
  token_uri: string;
};

export class GoogleNotConfiguredError extends Error {
  code = "not_configured" as const;
  constructor(detail = "Google service account not configured") {
    super(detail);
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadKey(): ServiceAccountKey | null {
  const raw = process.env.GMC_GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  // Try base64 first (Netlify-safe), then raw JSON.
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.startsWith("{")) {
      return JSON.parse(decoded) as ServiceAccountKey;
    }
  } catch {
    // fall through
  }
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    throw new GoogleNotConfiguredError(
      "GMC_GOOGLE_SERVICE_ACCOUNT_JSON is set but not valid JSON or base64-encoded JSON",
    );
  }
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GMC_GOOGLE_SERVICE_ACCOUNT_JSON);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function mintJwt(key: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: key.client_email,
    scope: SCOPES,
    aud: key.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(key.private_key).toString("base64url");
  return `${unsigned}.${sig}`;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const key = loadKey();
  if (!key) throw new GoogleNotConfiguredError();

  const jwt = mintJwt(key);
  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}
