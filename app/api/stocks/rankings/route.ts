import { NextRequest, NextResponse } from "next/server";
import { getMockAccessToken, MOCK_DOMAIN, type MockEnvironment } from "../../kiwoom.server";

export const dynamic = "force-dynamic";

type RankingKind = "trading-value" | "gainers" | "volume" | "popular";
type KiwoomBody = Record<string, unknown> & { return_code?: number; return_msg?: string };

const domesticConfig: Record<RankingKind, { trId: string; path: string; list: string; body: Record<string, string> }> = {
  "trading-value": { trId: "ka10032", path: "/api/dostk/rkinfo", list: "trde_prica_upper", body: { mrkt_tp: "000", mang_stk_incls: "0", stex_tp: "3" } },
  gainers: { trId: "ka10027", path: "/api/dostk/rkinfo", list: "pred_pre_flu_rt_upper", body: { mrkt_tp: "000", sort_tp: "1", trde_qty_cnd: "0000", stk_cnd: "0", crd_cnd: "0", updown_incls: "1", pric_cnd: "0", trde_prica_cnd: "0", stex_tp: "3" } },
  volume: { trId: "ka10030", path: "/api/dostk/rkinfo", list: "tdy_trde_qty_upper", body: { mrkt_tp: "000", sort_tp: "1", mang_stk_incls: "0", crd_tp: "0", trde_qty_tp: "0", pric_tp: "0", trde_prica_tp: "0", mrkt_open_tp: "0", stex_tp: "3" } },
  popular: { trId: "ka00198", path: "/api/dostk/stkinfo", list: "item_inq_rank", body: { qry_tp: "1" } },
};

const overseasConfig: Record<RankingKind, { trId: string; path: string; list: string; body: Record<string, string> }> = {
  "trading-value": { trId: "usa20540", path: "/api/us/rkinfo", list: "result_list", body: { stex_tp: "0", inds_cd: "", stk_tp: "0", trde_qty_tp: "0", stk_cnd: "0", pric_cnd: "0", trde_prica_cnd: "0" } },
  gainers: { trId: "usa20910", path: "/api/us/rkinfo", list: "result_list", body: { stex_tp: "0", inds_cd: "", inds_cls_tp: "0", sort_tp: "1", stk_tp: "0", stk_cnd: "0", pric_cnd: "0", trde_prica_cnd: "0", trde_qty_tp: "" } },
  volume: { trId: "usa20530", path: "/api/us/rkinfo", list: "result_list", body: { stex_tp: "0", inds_cd: "", stk_tp: "0", trde_qty_tp: "0", qry_tp: "0", stk_cnd: "0", pric_cnd: "0", trde_prica_cnd: "0" } },
  popular: { trId: "usa01980", path: "/api/us/rkinfo", list: "result_list", body: { svc_type: "B281" } },
};

const numeric = (value: unknown) => Number(String(value ?? "0").replace(/[,+]/g, "")) || 0;
const absolute = (value: unknown) => Math.abs(numeric(value));

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  if (environment !== "mock-domestic" && environment !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  const domestic = environment === "mock-domestic";
  const configs = domestic ? domesticConfig : overseasConfig;

  try {
    const token = await getMockAccessToken(environment as MockEnvironment);
    const entries = await Promise.all((Object.entries(configs) as [RankingKind, typeof configs[RankingKind]][]).map(async ([kind, config]) => {
      const response = await fetch(`${MOCK_DOMAIN}${config.path}`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": config.trId, authorization: `Bearer ${token}` }, body: JSON.stringify(config.body), cache: "no-store" });
      const body = await response.json() as KiwoomBody;
      if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || `${config.trId} 순위를 불러오지 못했습니다.`);
      const rows = Array.isArray(body[config.list]) ? body[config.list] as Record<string, unknown>[] : [];
      return [kind, { trId: config.trId, items: rows.slice(0, 5).map((row, index) => ({
        rank: numeric(row.rank ?? row.now_rank ?? row.bigd_rank) || index + 1,
        code: String(row.stk_cd ?? "").replace(/^A/, ""),
        name: String(row.stk_nm ?? ""),
        englishName: domestic ? undefined : String(row.stk_enm ?? "") || undefined,
        market: domestic ? "KRX" : ({ ND: "NASDAQ", NY: "NYSE", NA: "AMEX" }[String(row.stex_tp)] ?? "미국"),
        marketCode: domestic ? "KRX" : String(row.stex_tp ?? ""),
        currentPrice: absolute(row.cur_prc ?? row.curr_pric ?? row.past_curr_prc),
        changeRate: numeric(row.flu_rt ?? row.diff_rate_for_prev ?? row.prev_base_chgr),
        value: absolute(kind === "trading-value" ? row.trde_prica : kind === "volume" ? (row.trde_qty ?? row.acc_trde_qty) : 0),
      })) }];
    }));
    return NextResponse.json({ environment, currency: domestic ? "KRW" : "USD", rankings: Object.fromEntries(entries), fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "순위 조회 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
