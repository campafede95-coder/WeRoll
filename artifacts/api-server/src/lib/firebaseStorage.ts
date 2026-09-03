import { createHash, createSign } from "node:crypto";

type FirebaseServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

type CachedAccessToken = {
  token: string;
  expiresAt: number;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

let cachedServiceAccount: FirebaseServiceAccount | null = null;
let cachedAccessToken: CachedAccessToken | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function serviceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (
      parsed
      && typeof parsed === "object"
      && "FIREBASE_SERVICE_ACCOUNT_JSON" in parsed
    ) {
      parsed = (parsed as Record<string, unknown>).FIREBASE_SERVICE_ACCOUNT_JSON;
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not a service-account object");
  }
  const credentials = parsed as Partial<FirebaseServiceAccount>;
  if (!credentials.client_email || !credentials.private_key || !credentials.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields");
  }

  cachedServiceAccount = {
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, "\n"),
    project_id: credentials.project_id,
  };
  return cachedServiceAccount;
}

function storageBucket() {
  return process.env.FIREBASE_STORAGE_BUCKET?.trim()
    || `${serviceAccount().project_id}.firebasestorage.app`;
}

async function accessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const account = serviceAccount();
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: STORAGE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedJwt = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(unsignedJwt)
    .end()
    .sign(account.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Firebase Storage authentication failed (${response.status}${payload.error ? `: ${payload.error}` : ""})`);
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.token;
}

export async function uploadFirebaseImage(input: {
  objectPath: string;
  data: Buffer;
  contentType: string;
}) {
  const bucket = storageBucket();
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", input.objectPath);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": input.contentType,
    },
    body: input.data,
  });
  if (!response.ok) {
    throw new Error(`Firebase Storage upload failed (${response.status})`);
  }
  return `gs://${bucket}/${input.objectPath}`;
}

export async function deleteFirebaseObject(reference: string) {
  const parsed = parseFirebaseStorageReference(reference);
  if (!parsed) return;
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.objectPath)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await accessToken()}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Firebase Storage cleanup failed (${response.status})`);
  }
}

export function parseFirebaseStorageReference(reference: string) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(reference);
  if (!match) return null;
  return { bucket: match[1], objectPath: match[2] };
}

function encodeQueryValue(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function createFirebaseImageUrl(reference: string) {
  const parsed = parseFirebaseStorageReference(reference);
  if (!parsed) return reference;

  const account = serviceAccount();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const canonicalUri = `/download/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.objectPath)}`;
  const query = new Map<string, string>([
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", `${account.client_email}/${credentialScope}`],
    ["X-Goog-Date", timestamp],
    ["X-Goog-Expires", String(SIGNED_URL_TTL_SECONDS)],
    ["X-Goog-SignedHeaders", "host"],
    ["alt", "media"],
  ]);
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeQueryValue(key)}=${encodeQueryValue(value)}`)
    .join("&");
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    "host:storage.googleapis.com\n",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createSign("RSA-SHA256")
    .update(stringToSign)
    .end()
    .sign(account.private_key, "hex");

  return `https://storage.googleapis.com${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}