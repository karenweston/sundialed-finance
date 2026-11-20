// Minimal Google service-account auth + Sheets read, using only Web Crypto and fetch.
// Every read uses the read-only scope. The one write (appending imported Apple Card rows)
// asks for a separate, short-lived token with the edit scope, and only when there is something to write.

const READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}


/** Google's own explanation of a failed request (an error message, never credentials). */
async function reason(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const e = j.error;
    const detail = e?.details?.find((d: { reason?: string }) => d.reason)?.reason;
    return [detail, e?.message ?? e_desc(j)].filter(Boolean).join(" - ").slice(0, 300);
  } catch {
    return "no details";
  }
}
const e_desc = (j: { error_description?: string; error?: string }) => j.error_description ?? j.error;

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function getAccessToken(keyJson: string, scope: string = READ_SCOPE): Promise<string> {
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(keyJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importPrivateKey(key.private_key),
    new TextEncoder().encode(signingInput),
  );
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await reason(res)}`);
  return (await res.json()).access_token as string;
}

/** Fetch several tabs in one request. Returns tab name -> rows of displayed values. */
export async function readTabs(
  token: string,
  sheetId: string,
  tabs: string[],
): Promise<Record<string, (string | number | null)[][]>> {
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
  for (const t of tabs) params.append("ranges", `'${t.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read failed (${res.status}): ${await reason(res)}`);
  const json = await res.json();
  const out: Record<string, (string | number | null)[][]> = {};
  tabs.forEach((t, i) => {
    out[t] = json.valueRanges?.[i]?.values ?? [];
  });
  return out;
}

/** Every tab's name, in order. */
export async function listTabNames(token: string, sheetId: string): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets tab list failed (${res.status}): ${await reason(res)}`);
  const json = await res.json();
  return (json.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
}

/** Like readTabs, but numbers and dates come back raw (dates as day serial numbers), not as display text. */
export async function readTabsRaw(
  token: string,
  sheetId: string,
  tabs: string[],
): Promise<Record<string, (string | number | null)[][]>> {
  const out: Record<string, (string | number | null)[][]> = {};
  if (!tabs.length) return out;
  const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  for (const t of tabs) params.append("ranges", `'${t.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read failed (${res.status}): ${await reason(res)}`);
  const json = await res.json();
  tabs.forEach((t, i) => {
    out[t] = json.valueRanges?.[i]?.values ?? [];
  });
  return out;
}

/** Write the given ranges as typed values. Used only for the planned AppleCard append. */
export async function writeRanges(
  token: string,
  sheetId: string,
  data: { range: string; values: (string | number)[][] }[],
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  if (!res.ok) throw new Error(`Sheets write failed (${res.status}): ${await reason(res)}`);
}

/** One tab with formulas shown as text (=SUM(...)), so a planned write can avoid overwriting them. */
export async function readTabFormulas(token: string, sheetId: string, tab: string): Promise<(string | number | null)[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?valueRenderOption=FORMULA`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read failed (${res.status}): ${await reason(res)}`);
  return (await res.json()).values ?? [];
}
