import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, getApiDomain, isDomestic, isInvestmentEnvironment, resolveUsMarket } from "../../kiwoom.server";
import { anonymizeStock } from "../../../stock-anonymizer.server";

export const dynamic = "force-dynamic";
const num = (value: unknown) => Math.abs(Number(String(value ?? "0").replace(/,/g, "")) || 0);
const signedNum = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  let marketCode = request.nextUrl.searchParams.get("marketCode")?.trim() ?? "";
  if (!isInvestmentEnvironment(environment)) return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  if (!code) return NextResponse.json({ message: "종목코드가 필요합니다." }, { status: 400 });
  const domestic = isDomestic(environment);
  try {
    const token = await getAccessToken(environment);
    if (!domestic && !["NA", "ND", "NY"].includes(marketCode)) marketCode = await resolveUsMarket(code, token, environment);
    const trId = domestic ? "ka10001" : "usa20100";
    const response = await fetch(`${getApiDomain(environment)}${domestic ? "/api/dostk/stkinfo" : "/api/us/mrkcond"}`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` }, body: JSON.stringify(domestic ? { stk_cd: code } : { stex_tp: marketCode, stk_cd: code }), cache: "no-store" });
    const body = await response.json() as Record<string, unknown> & { return_msg?: string };
    if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || "종목 정보를 불러오지 못했습니다.");
    const detail = { trId, marketCode: domestic ? "KRX" : marketCode, code: String(body.stk_cd ?? code), name: String(body.stk_nm ?? ""), englishName: domestic ? undefined : String(body.stk_enm ?? ""), currency: domestic ? "KRW" as const : "USD" as const, currentPrice: num(body.cur_prc), change: signedNum(body.pred_pre), changeRate: signedNum(body.flu_rt), openPrice: num(body.open_pric), highPrice: num(body.high_pric), lowPrice: num(body.low_pric), volume: num(domestic ? body.trde_qty : body.acc_trde_qty), suspended: domestic ? false : body.trd_susp_tp !== "0" };
    return NextResponse.json(anonymizeStock(detail, domestic), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "종목 정보 조회 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
