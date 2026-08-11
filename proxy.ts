import { NextRequest, NextResponse } from "next/server";
import { isValidSession, SESSION_COOKIE } from "./app/auth.server";

export async function proxy(request: NextRequest) {
  const valid = await isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (valid) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { message: "인증이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.svg|og.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
