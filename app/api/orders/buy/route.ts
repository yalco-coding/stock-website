import { NextRequest, NextResponse } from "next/server";
import { getMockAccessToken, MOCK_DOMAIN, normalizeDomesticStockCode, type MockEnvironment } from "../../kiwoom.server";
import { getPositionQuantity, startOrderMonitor } from "../order-monitor.server";
import { loggedFetch as fetch } from "../../../external-api-logger.server";

export const dynamic = "force-dynamic";
type BuyRequest = { environment?: string; requestId?: string; code?: string; marketCode?: string; quantity?: number; orderType?: "limit" | "market"; price?: number };
type OrderResult = { orderNo: string; message: string; trId: string; marketCode: string; baselineQuantity: number };
const orders = new Map<string, { createdAt: number; result: Promise<OrderResult> }>();

class OrderRejectedError extends Error {}

async function placeOrder(body: Required<Pick<BuyRequest, "environment" | "requestId" | "code" | "marketCode" | "quantity" | "orderType">> & Pick<BuyRequest, "price">): Promise<OrderResult> {
  const environment = body.environment as MockEnvironment;
  const domestic = environment === "mock-domestic";
  const baselineQuantity = await getPositionQuantity(environment, body.code);
  const token = await getMockAccessToken(environment);
  const trId = domestic ? "kt10000" : "ust20000";
  const overseasOrderPrice = body.orderType === "limit" ? Number(body.price) < 1 ? Number(body.price).toFixed(4) : Number(body.price).toFixed(2) : "";
  const payload = domestic ? {
    dmst_stex_tp: body.marketCode, stk_cd: body.code, ord_qty: String(body.quantity), ord_uv: body.orderType === "limit" ? String(body.price) : "", trde_tp: body.orderType === "limit" ? "0" : "3", cond_uv: "",
  } : {
    stex_tp: body.marketCode, stk_cd: body.code, ord_qty: String(body.quantity), ord_uv: overseasOrderPrice, trde_tp: body.orderType === "limit" ? "00" : "03",
  };
  const response = await fetch(`${MOCK_DOMAIN}${domestic ? "/api/dostk/ordr" : "/api/us/ordr"}`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` }, body: JSON.stringify(payload), cache: "no-store" });
  const result = await response.json() as { ord_no?: string; return_code?: number; return_msg?: string };
  if (response.ok && (Number(result.return_code ?? 0) !== 0 || !result.ord_no)) throw new OrderRejectedError(result.return_msg || "키움에서 매수 주문을 거절했습니다.");
  if (!response.ok) throw new Error(result.return_msg || "키움 주문 서버에 연결하지 못했습니다.");
  return { orderNo: result.ord_no!, message: result.return_msg || "매수 주문이 접수되었습니다.", trId, marketCode: body.marketCode, baselineQuantity };
}

export async function POST(request: NextRequest) {
  let body: BuyRequest;
  try { body = await request.json() as BuyRequest; } catch { return NextResponse.json({ message: "올바른 주문 요청이 아닙니다." }, { status: 400 }); }
  const domestic = body.environment === "mock-domestic";
  if (!domestic && body.environment !== "mock-overseas") return NextResponse.json({ message: "실투자 주문은 비활성화되어 있습니다." }, { status: 403 });
  if (!body.requestId || !/^[0-9a-f-]{36}$/i.test(body.requestId)) return NextResponse.json({ message: "주문 확인 정보가 유효하지 않습니다." }, { status: 400 });
  if (!body.code || !/^([0-9A-Z._-]{1,12})$/i.test(body.code)) return NextResponse.json({ message: "종목코드가 유효하지 않습니다." }, { status: 400 });
  if (domestic) body.code = normalizeDomesticStockCode(body.code);
  if (domestic ? body.marketCode !== "KRX" : !["NA", "ND", "NY"].includes(body.marketCode ?? "")) return NextResponse.json({ message: domestic ? "국내 모의투자는 KRX 종목만 지원합니다." : "해외 모의투자는 미국 거래소 종목만 지원합니다." }, { status: 400 });
  if (!Number.isSafeInteger(body.quantity) || Number(body.quantity) < 1) return NextResponse.json({ message: "주문수량은 1주 이상의 정수여야 합니다." }, { status: 400 });
  if (!body.orderType || !["limit", "market"].includes(body.orderType)) return NextResponse.json({ message: "지원하지 않는 주문 유형입니다." }, { status: 400 });
  if (body.orderType === "limit" && (!Number.isFinite(body.price) || Number(body.price) <= 0)) return NextResponse.json({ message: "지정가 주문에는 유효한 주문가격이 필요합니다." }, { status: 400 });
  if (!domestic && body.orderType === "limit" && Number((Number(body.price) < 1 ? Number(body.price).toFixed(4) : Number(body.price).toFixed(2))) <= 0) return NextResponse.json({ message: "미국주식 주문가격은 $1 미만 4자리, $1 이상 2자리 단위로 입력해 주세요." }, { status: 400 });
  const key = `${body.environment}:${body.requestId}`;
  const now = Date.now();
  for (const [storedKey, entry] of orders) if (entry.createdAt < now - 10 * 60 * 1000) orders.delete(storedKey);
  let entry = orders.get(key);
  const duplicatePrevented = !!entry;
  if (!entry) {
    entry = { createdAt: now, result: placeOrder(body as Parameters<typeof placeOrder>[0]) };
    orders.set(key, entry);
  }
  try {
    const result = await entry.result;
    startOrderMonitor({ environment: body.environment as MockEnvironment, side: "buy", orderNo: result.orderNo, code: body.code!, marketCode: result.marketCode, orderedQuantity: body.quantity!, baselineQuantity: result.baselineQuantity });
    return NextResponse.json({ ...result, duplicatePrevented }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "주문 접수 중 오류가 발생했습니다." }, { status: error instanceof OrderRejectedError ? 422 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
