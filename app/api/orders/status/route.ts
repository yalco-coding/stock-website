import { NextRequest, NextResponse } from "next/server";
import { findOrderByBrokerOrderNo } from "../../../strategy-engine/store.server";
import { publicOrder, reconcileOrder } from "../../../strategy-engine/order-coordinator.server";
import { sendTelegramNotificationOnce } from "../../../telegram.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const orderNo = request.nextUrl.searchParams.get("orderNo")?.trim() ?? "";
  if (environment !== "mock-domestic" && environment !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  if (!orderNo) return NextResponse.json({ message: "주문번호가 필요합니다." }, { status: 400 });
  const stored = findOrderByBrokerOrderNo(environment, orderNo);
  if (!stored) return NextResponse.json({ message: "영속 주문 장부에서 주문을 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const order = await reconcileOrder(stored);
    if (order.state === "filled") {
      const sideLabel = order.side === "sell" ? "매도" : "매수";
      await sendTelegramNotificationOnce(
        `${order.environment}:${order.side}:${order.brokerOrderNo}`,
        order.side === "sell" ? "sellFilled" : "buyFilled",
        `✅ ${sideLabel} 체결 감지\n종목코드: ${order.code}\n수량: ${order.filledQuantity}주\n주문번호: ${order.brokerOrderNo}`,
      );
    }
    return NextResponse.json(publicOrder(order), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "주문 상태 조회 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
