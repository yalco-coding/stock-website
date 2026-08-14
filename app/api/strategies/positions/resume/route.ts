import { NextResponse } from "next/server";
import { normalizeDomesticStockCode, type MockEnvironment } from "../../../kiwoom.server";
import { safelyResumePosition } from "../../../../strategy-engine/engine.server";

export const dynamic = "force-dynamic";

type ResumeRequest = { environment?: string; code?: string; marketCode?: string };

export async function POST(request: Request) {
  let body: ResumeRequest;
  try { body = await request.json() as ResumeRequest; }
  catch { return NextResponse.json({ message: "올바른 재개 요청이 아닙니다." }, { status: 400 }); }
  if (body.environment !== "mock-domestic" && body.environment !== "mock-overseas") return NextResponse.json({ message: "모의투자 종목만 재개할 수 있습니다." }, { status: 403 });
  if (!body.code || !/^[0-9A-Z._-]{1,12}$/i.test(body.code)) return NextResponse.json({ message: "종목코드가 유효하지 않습니다." }, { status: 400 });
  const domestic = body.environment === "mock-domestic";
  const marketCode = domestic ? "KRX" : String(body.marketCode ?? "").toUpperCase();
  if (!domestic && !["NA", "ND", "NY"].includes(marketCode)) return NextResponse.json({ message: "미국 거래소 코드가 필요합니다." }, { status: 400 });
  try {
    const position = await safelyResumePosition({
      environment: body.environment as MockEnvironment,
      code: domestic ? normalizeDomesticStockCode(body.code) : body.code.toUpperCase(),
      marketCode,
    });
    return NextResponse.json({ position }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "종목을 재개하지 못했습니다." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
