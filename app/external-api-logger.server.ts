import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const logPath = path.join(process.cwd(), ".data", "external-api.jsonl");
const sensitiveKey = /authorization|cookie|token|secret|password|passwd|appkey|api[-_]?key/i;
const REDACTED = "[REDACTED]";

function redact(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return value;
}

function safeUrl(input: string | URL | Request): string {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (sensitiveKey.test(key)) url.searchParams.set(key, REDACTED);
    url.pathname = url.pathname.replace(/\/bot[^/]+(?=\/)/i, `/bot${REDACTED}`);
    return url.toString();
  } catch { return raw; }
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return body ? "[NON_TEXT_BODY]" : undefined;
  try { return redact(JSON.parse(body)); }
  catch { return body; }
}

async function writeLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error("외부 API 로그 저장에 실패했습니다.", error);
  }
}

export async function loggedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const startedAt = new Date();
  const requestId = randomUUID();
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  const request = { method, url: safeUrl(input), body: parseBody(init.body) };
  try {
    const response = await fetch(input, init);
    let responseBody: unknown;
    try {
      const text = await response.clone().text();
      try { responseBody = redact(JSON.parse(text)); } catch { responseBody = text; }
    } catch { responseBody = "[UNREADABLE_BODY]"; }
    await writeLog({ timestamp: startedAt.toISOString(), requestId, request, response: { status: response.status, ok: response.ok, body: responseBody }, durationMs: Date.now() - startedAt.getTime() });
    return response;
  } catch (error) {
    await writeLog({ timestamp: startedAt.toISOString(), requestId, request, error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) }, durationMs: Date.now() - startedAt.getTime() });
    throw error;
  }
}
