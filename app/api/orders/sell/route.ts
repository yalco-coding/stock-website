import { NextRequest, NextResponse } from "next/server";
import { normalizeDomesticStockCode, type MockEnvironment } from "../../kiwoom.server";
import { ActiveSellConflictError, CoordinatedOrderRejectedError, CoordinatedOrderUnknownError, PositionPausedError, publicOrder, submitCoordinatedOrder } from "../../../strategy-engine/order-coordinator.server";

export const dynamic = "force-dynamic";

type SellRequest = {
  environment?: string;
  requestId?: string;
  code?: string;
  marketCode?: string;
  quantity?: number;
  orderType?: "limit" | "market";
  price?: number;
};

export async function POST(request: NextRequest) {
  let body: SellRequest;
  try {
    body = await request.json() as SellRequest;
  } catch {
    return NextResponse.json({ message: "올바른 주문 요청이 아닙니다." }, { status: 400 });
  }
  const domestic = body.environment === "mock-domestic";
  if (!domestic && body.environment !== "mock-overseas") return NextResponse.json({ message: "실투자 주문은 비활성화되어 있습니다." }, { status: 403 });
  if (!body.requestId || !/^[0-9a-f-]{36}$/i.test(body.requestId)) return NextResponse.json({ message: "주문 확인 정보가 유효하지 않습니다." }, { status: 400 });
  if (!body.code || !/^([0-9A-Z._-]{1,12})$/i.test(body.code)) return NextResponse.json({ message: "종목코드가 유효하지 않습니다." }, { status: 400 });
  const code = domestic ? normalizeDomesticStockCode(body.code) : body.code.toUpperCase();
  if (!Number.isSafeInteger(body.quantity) || Number(body.quantity) < 1) return NextResponse.json({ message: "주문수량은 1주 이상의 정수여야 합니다." }, { status: 400 });
  if (!body.orderType || !["limit", "market"].includes(body.orderType)) return NextResponse.json({ message: "지원하지 않는 주문 유형입니다." }, { status: 400 });
  if (body.orderType === "limit" && (!Number.isFinite(body.price) || Number(body.price) <= 0)) return NextResponse.json({ message: "지정가 주문에는 유효한 주문가격이 필요합니다." }, { status: 400 });
  try {
    const result = await submitCoordinatedOrder({
      environment: body.environment as MockEnvironment,
      requestId: body.requestId,
      side: "sell",
      source: "manual",
      code,
      marketCode: body.marketCode,
      quantity: Number(body.quantity),
      orderType: body.orderType,
      price: body.price,
      reasons: ["앱에서 사용자가 직접 매도"],
    });
    if (!result.order.brokerOrderNo) {
      return NextResponse.json({ message: "동일 요청의 처리 결과를 확인하고 있습니다.", activeOrder: publicOrder(result.order) }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ...publicOrder(result.order), duplicatePrevented: result.duplicatePrevented }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ActiveSellConflictError) {
      return NextResponse.json({ message: error.message, activeOrder: publicOrder(error.activeOrder) }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof PositionPausedError) {
      return NextResponse.json({ message: `${error.message} 전략 상태에서 재확인 후 재개해 주세요.` }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof CoordinatedOrderRejectedError) {
      return NextResponse.json({ message: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof CoordinatedOrderUnknownError) {
      return NextResponse.json({ message: `${error.message} 중복 방지를 위해 이 종목을 잠갔습니다.`, activeOrder: publicOrder(error.order) }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : "주문 접수 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
