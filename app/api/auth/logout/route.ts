import { NextRequest, NextResponse } from "next/server";
import { isHttpsRequest, SESSION_COOKIE } from "../../../auth.server";

export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return NextResponse.json({ message: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const response = NextResponse.json({ redirectTo: "/login" }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: isHttpsRequest(request), sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
