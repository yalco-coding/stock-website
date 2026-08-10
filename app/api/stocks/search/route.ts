import { NextRequest, NextResponse } from "next/server";
import { getMockAccessToken, MOCK_DOMAIN, type MockEnvironment } from "../../kiwoom.server";

export const dynamic = "force-dynamic";
type Stock = { code: string; name: string; englishName?: string; market: string; industry?: string; isEtf?: boolean };
type CacheEntry = { expiresAt: number; stocks: Stock[] };
const stockCache = new Map<MockEnvironment, CacheEntry>();
const MARKET_TYPES = ["0", "10", "8"] as const;

async function requestList(environment: MockEnvironment, token: string, marketType?: string) {
  const domestic = environment === "mock-domestic";
  const trId = domestic ? "ka10099" : "usa10099";
  const response = await fetch(`${MOCK_DOMAIN}${domestic ? "/api/dostk/stkinfo" : "/api/us/stkinfo"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` },
    body: JSON.stringify(domestic ? { mrkt_tp: marketType } : { stex_tp: "%" }),
    cache: "no-store",
  });
  const body = await response.json() as { return_code?: number; return_msg?: string; list?: Record<string, unknown>[] };
  if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || "종목 목록을 불러오지 못했습니다.");
  return (body.list ?? []).map((item): Stock => domestic ? {
    code: String(item.code ?? ""), name: String(item.name ?? ""), market: String(item.marketName ?? ""), industry: String(item.upName ?? "") || undefined, isEtf: marketType === "8",
  } : {
    code: String(item.stk_cd ?? ""), name: String(item.stk_nm ?? ""), englishName: String(item.stk_enm ?? "") || undefined, market: String(item.mkgb ?? ""), industry: String(item.upgb ?? "") || undefined, isEtf: item.isEtf === "Y",
  });
}

async function loadStocks(environment: MockEnvironment) {
  const cached = stockCache.get(environment);
  if (cached && cached.expiresAt > Date.now()) return cached.stocks;
  const token = await getMockAccessToken(environment);
  let stocks: Stock[];
  if (environment === "mock-domestic") {
    stocks = [];
    for (const [index, market] of MARKET_TYPES.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_100));
      stocks.push(...await requestList(environment, token, market));
    }
  } else {
    stocks = await requestList(environment, token);
  }
  stockCache.set(environment, { expiresAt: Date.now() + 10 * 60 * 1000, stocks });
  return stocks;
}

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (environment !== "mock-domestic" && environment !== "mock-overseas") return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
  if (!query) return NextResponse.json({ message: "종목명이나 종목코드를 입력해 주세요." }, { status: 400 });
  try {
    const normalized = query.toLocaleLowerCase("ko-KR");
    const rank = (stock: Stock) => {
      const code = stock.code.toLocaleLowerCase();
      const name = stock.name.toLocaleLowerCase("ko-KR");
      const englishName = stock.englishName?.toLocaleLowerCase() ?? "";
      if (code === normalized || name === normalized || englishName === normalized) return 0;
      if (code.startsWith(normalized) || name.startsWith(normalized) || englishName.startsWith(normalized)) return 1;
      return 2;
    };
    const results = (await loadStocks(environment)).filter((stock) => stock.code.toLocaleLowerCase().includes(normalized) || stock.name.toLocaleLowerCase("ko-KR").includes(normalized) || stock.englishName?.toLocaleLowerCase().includes(normalized)).sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code)).slice(0, 50);
    return NextResponse.json({ category: environment === "mock-domestic" ? "domestic" : "overseas", trId: environment === "mock-domestic" ? "ka10099" : "usa10099", query, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "종목 검색 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
