import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, isHttpsRequest, safeReturnPath, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyPassword } from "../../../auth.server";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientId(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function sameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return ["same-origin", "none"].includes(fetchSite);

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    || request.headers.get("host")?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    || request.nextUrl.protocol.replace(":", "");
  return Boolean(host) && origin === `${protocol}://${host}`;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ message: "허용되지 않은 요청입니다." }, { status: 403 });

  const now = Date.now();
  const id = clientId(request);
  let limit = attempts.get(id);
  if (!limit || limit.resetAt <= now) limit = { count: 0, resetAt: now + WINDOW_MS };
  if (limit.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil((limit.resetAt - now) / 1000)) } },
    );
  }

  let body: { password?: unknown; next?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ message: "잘못된 요청입니다." }, { status: 400 }); }

  if (typeof body.password !== "string" || !(await verifyPassword(body.password))) {
    limit.count += 1;
    attempts.set(id, limit);
    return NextResponse.json(
      { message: "비밀번호가 올바르지 않습니다.", attemptsRemaining: Math.max(MAX_ATTEMPTS - limit.count, 0) },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let sessionToken: string;
  try {
    sessionToken = await createSessionToken(now);
  } catch {
    return NextResponse.json(
      { message: "서버의 비밀번호 인증 설정이 완료되지 않았습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  attempts.delete(id);
  const response = NextResponse.json({ redirectTo: safeReturnPath(body.next) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
