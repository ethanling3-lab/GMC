import "server-only";
import { getAccessToken } from "./auth";

// Sheets helpers. Each export rewrites the named tab end-to-end:
//   1. List existing tabs (skip if already present)
//   2. addSheet via batchUpdate if missing
//   3. values:clear to reset existing tab
//   4. values.update to write new values starting at A1
//
// Idempotent — running export twice in a row produces the same final state.

export async function writeTab(
  spreadsheetId: string,
  tabName: string,
  values: (string | number)[][],
): Promise<void> {
  const token = await getAccessToken();

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Sheets meta failed: ${metaRes.status} ${text}`);
  }
  const meta = (await metaRes.json()) as {
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  };
  const existing = meta.sheets.find((s) => s.properties.title === tabName);

  if (!existing) {
    const addRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tabName } } }],
        }),
      },
    );
    if (!addRes.ok) {
      const text = await addRes.text();
      throw new Error(`Sheets addSheet failed: ${addRes.status} ${text}`);
    }
  } else {
    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!clearRes.ok) {
      const text = await clearRes.text();
      throw new Error(`Sheets clear failed: ${clearRes.status} ${text}`);
    }
  }

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!writeRes.ok) {
    const text = await writeRes.text();
    throw new Error(`Sheets write failed: ${writeRes.status} ${text}`);
  }
}
