const encoder = new TextEncoder();

export const SESSION_COOKIE = "kiwoom_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

type SessionPayload = { expiresAt: number; nonce: string };

function sessionSigningSecret(): string {
  const password = process.env.PASSWORD;
  if (!password) throw new Error("PASSWORD is not configured.");
  return `kiwoom-ledger:session:v1:${password}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const configured = process.env.PASSWORD;
  const [candidateHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured ?? "missing-password")),
  ]);
  return Boolean(configured) && constantTimeEqual(new Uint8Array(candidateHash), new Uint8Array(configuredHash));
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${base64Url(await hmac(encodedPayload))}`;
}

export async function isValidSession(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return false;
  try {
    const signature = fromBase64Url(encodedSignature);
    if (!constantTimeEqual(signature, await hmac(encodedPayload))) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as Partial<SessionPayload>;
    return typeof payload.expiresAt === "number" && payload.expiresAt > now && typeof payload.nonce === "string";
  } catch {
    return false;
  }
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local" || url.pathname.startsWith("/login")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
