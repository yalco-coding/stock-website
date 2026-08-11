import { NextRequest, NextResponse } from "next/server";
import { getMockAccessToken, MOCK_DOMAIN, type MockEnvironment } from "../../kiwoom.server";

export const dynamic = "force-dynamic";
const num = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const orderNo = request.nextUrl.searchParams.get("orderNo")?.trim() ?? "";
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const marketCode = request.nextUrl.searchParams.get("marketCode")?.trim() ?? "";
  const side = request.nextUrl.searchParams.get("side") === "sell" ? "sell" : "buy";
  if (environment !== "mock-domestic" && environment !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  if (!orderNo || !code) return NextResponse.json({ message: "주문번호와 종목코드가 필요합니다." }, { status: 400 });
  try {
    const domestic = environment === "mock-domestic";
    const token = await getMockAccessToken(environment as MockEnvironment);
    const trId = domestic ? "kt00009" : "ust21510";
    const payload = domestic ? { ord_dt: "", stk_bond_tp: "0", mrkt_tp: "0", sell_tp: side === "sell" ? "1" : "2", qry_tp: "0", stk_cd: code, fr_ord_no: orderNo, dmst_stex_tp: marketCode } : { slby_tp: side === "sell" ? "1" : "2", stex_tp: marketCode, stk_cd: code };
    const response = await fetch(`${MOCK_DOMAIN}${domestic ? "/api/dostk/acnt" : "/api/us/acnt"}`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` }, body: JSON.stringify(payload), cache: "no-store" });
    const body = await response.json() as Record<string, unknown> & { return_msg?: string; acnt_ord_cntr_prst_array?: Record<string, unknown>[]; result_list?: Record<string, unknown>[] };
    if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || "주문 상태를 확인하지 못했습니다.");
    const list = domestic ? body.acnt_ord_cntr_prst_array ?? [] : body.result_list ?? [];
    const order = list.find((item) => String(item.ord_no ?? "").replace(/^0+/, "") === orderNo.replace(/^0+/, ""));
    if (!order) return NextResponse.json({ trId, status: "pending", label: "접수 확인 중", filledQuantity: 0, remainingQuantity: 0 }, { headers: { "Cache-Control": "no-store" } });
    const ordered = num(order.ord_qty);
    const filled = num(order.cntr_qty);
    const remaining = domestic ? Math.max(ordered - filled, 0) : num(order.ord_remnq);
    const status = filled >= ordered && ordered > 0 ? "filled" : filled > 0 ? "partial" : "pending";
    return NextResponse.json({ trId, status, label: status === "filled" ? "체결 완료" : status === "partial" ? "일부 체결" : String(order.ord_stat ?? order.acpt_tp ?? "미체결"), orderedQuantity: ordered, filledQuantity: filled, remainingQuantity: remaining, filledPrice: num(order.cntr_uv) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "주문 상태 조회 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
