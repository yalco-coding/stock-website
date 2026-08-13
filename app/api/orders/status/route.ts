import { NextRequest, NextResponse } from "next/server";
import { getOrderStatus } from "../order-monitor.server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const orderNo = request.nextUrl.searchParams.get("orderNo")?.trim() ?? "";
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const marketCode = request.nextUrl.searchParams.get("marketCode")?.trim() ?? "";
  const side = request.nextUrl.searchParams.get("side") === "sell" ? "sell" : "buy";
  if (environment !== "mock-domestic" && environment !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  if (!orderNo || !code) return NextResponse.json({ message: "주문번호와 종목코드가 필요합니다." }, { status: 400 });
  try {
    const status = await getOrderStatus({ environment, side, orderNo, code, marketCode });
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "주문 상태 조회 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
