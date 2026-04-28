import "server-only";
import { getAccessToken } from "./auth";

// Drive helpers — only what the transfer-list export needs:
//   * createSpreadsheet — make a new Sheets file inside a Drive folder
//   * shareWithUser     — grant a person/group write access (used optionally
//                         when GMC_TRANSFER_SHARE_EMAILS is configured)

export async function createSpreadsheet(
  name: string,
  parentFolderId?: string | null,
): Promise<{ id: string; url: string }> {
  const token = await getAccessToken();
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.spreadsheet",
  };
  if (parentFolderId) body.parents = [parentFolderId];

  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive create failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: json.id,
    url:
      json.webViewLink ??
      `https://docs.google.com/spreadsheets/d/${json.id}/edit`,
  };
}

export async function shareWithUser(
  fileId: string,
  email: string,
  role: "reader" | "writer" = "writer",
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role, type: "user", emailAddress: email }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive permission failed: ${res.status} ${text}`);
  }
}
