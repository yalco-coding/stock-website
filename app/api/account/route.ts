import { NextRequest, NextResponse } from "next/server";
import { getMockAccessToken, MOCK_DOMAIN, type MockEnvironment } from "../kiwoom.server";

export const dynamic = "force-dynamic";
const num = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("environment");
  if (requested !== "mock-domestic" && requested !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  const environment = requested as MockEnvironment;
  try {
    const token = await getMockAccessToken(environment);
    const domestic = environment === "mock-domestic";
    const trId = domestic ? "kt00018" : "ust21070";
    const apiHeaders = { "Content-Type": "application/json;charset=UTF-8", authorization: `Bearer ${token}` };
    const response = await fetch(`${MOCK_DOMAIN}${domestic ? "/api/dostk/acnt" : "/api/us/acnt"}`, { method: "POST", headers: { ...apiHeaders, "api-id": trId }, body: JSON.stringify(domestic ? { qry_tp: "1", dmst_stex_tp: "KRX" } : { stex_tp: "", stk_cd: "" }), cache: "no-store" });
    const body = await response.json() as Record<string, unknown> & { return_msg?: string; acnt_evlt_remn_indv_tot?: Record<string, unknown>[]; result_list?: Record<string, unknown>[] };
    if (!response.ok || num(body.return_code) !== 0) throw new Error(body.return_msg || "키움 계좌 조회에 실패했습니다.");
    const positions = domestic
      ? (body.acnt_evlt_remn_indv_tot ?? []).map((p) => ({ code: String(p.stk_cd ?? "").replace(/^[AJQ]/, ""), name: String(p.stk_nm ?? ""), market: "KRX", marketCode: "KRX", quantity: num(p.rmnd_qty), availableQuantity: num(p.trde_able_qty), averagePrice: num(p.pur_pric), currentPrice: Math.abs(num(p.cur_prc)), purchaseAmount: num(p.pur_amt), evaluationAmount: num(p.evlt_amt), profitLoss: num(p.evltv_prft), returnRate: num(p.prft_rt) }))
      : (body.result_list ?? []).map((p) => ({ code: String(p.stk_cd ?? ""), name: String(p.frgn_stk_nm ?? ""), market: String(p.stex_nm ?? "미국"), marketCode: "", quantity: num(p.poss_qty), availableQuantity: num(p.sell_alowq), averagePrice: num(p.frgn_stk_book_uv), currentPrice: num(p.now_pric), purchaseAmount: num(p.frgn_stk_book_amt), evaluationAmount: num(p.evlt_amt), profitLoss: num(p.pl_amt), returnRate: num(p.pl_rt) }));
    let cash;
    if (!domestic) {
      const cashResponse = await fetch(`${MOCK_DOMAIN}/api/us/acnt`, { method: "POST", headers: { ...apiHeaders, "api-id": "ust21110" }, body: "{}", cache: "no-store" });
      const cashBody = await cashResponse.json() as Record<string, unknown> & { return_msg?: string; result_list?: Record<string, unknown>[] };
      if (!cashResponse.ok || num(cashBody.return_code) !== 0) throw new Error(cashBody.return_msg || "해외주식 예수금 조회에 실패했습니다.");
      const usd = (cashBody.result_list ?? []).find((item) => item.crnc_code === "USD");
      cash = {
        krwDeposit: num(cashBody.krw_entra),
        usdDeposit: num(usd?.fc_entra),
        usdWithdrawable: num(usd?.fc_pymn_alowa),
        usdOrderable: num(usd?.fc_ord_alowa),
      };
    }
    return NextResponse.json({ environment, currency: domestic ? "KRW" : "USD", trId: domestic ? trId : `${trId}, ust21110`, totalPurchase: num(domestic ? body.tot_pur_amt : body.tot_prch_amt), totalEvaluation: num(body.tot_evlt_amt), totalProfitLoss: num(domestic ? body.tot_evlt_pl : body.tot_pl_amt), totalReturnRate: num(domestic ? body.tot_prft_rt : body.tot_pl_rt), estimatedAssets: domestic ? num(body.prsm_dpst_aset_amt) : undefined, cash, positions, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "계좌 조회 중 오류가 발생했습니다.";
    return NextResponse.json({ message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
