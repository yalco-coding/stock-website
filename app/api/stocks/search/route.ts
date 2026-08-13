import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, getApiDomain, isDomestic, isInvestmentEnvironment, normalizeDomesticStockCode, type InvestmentEnvironment } from "../../kiwoom.server";
import { anonymizeStock } from "../../../stock-anonymizer.server";
import { loggedFetch as fetch } from "../../../external-api-logger.server";

export const dynamic = "force-dynamic";
type Stock = { code: string; name: string; englishName?: string; market: string; marketCode: string; industry?: string; isEtf?: boolean };
type CacheEntry = { expiresAt: number; stocks: Stock[] };
const stockCache = new Map<InvestmentEnvironment, CacheEntry>();
const MARKET_TYPES = ["0", "10", "8"] as const;

async function requestList(environment: InvestmentEnvironment, token: string, marketType?: string) {
  const domestic = isDomestic(environment);
  const trId = domestic ? "ka10099" : "usa10099";
  const response = await fetch(`${getApiDomain(environment)}${domestic ? "/api/dostk/stkinfo" : "/api/us/stkinfo"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` },
    body: JSON.stringify(domestic ? { mrkt_tp: marketType } : { stex_tp: "%" }),
    cache: "no-store",
  });
  const body = await response.json() as { return_code?: number; return_msg?: string; list?: Record<string, unknown>[] };
  if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || "종목 목록을 불러오지 못했습니다.");
  return (body.list ?? []).map((item): Stock => domestic ? {
    code: normalizeDomesticStockCode(String(item.code ?? "")), name: String(item.name ?? ""), market: String(item.marketName ?? ""), marketCode: "KRX", industry: String(item.upName ?? "") || undefined, isEtf: marketType === "8",
  } : {
    code: String(item.stk_cd ?? ""), name: String(item.stk_nm ?? ""), englishName: String(item.stk_enm ?? "") || undefined, market: String(item.mkgb ?? ""), marketCode: String(item.stex_tp ?? ""), industry: String(item.upgb ?? "") || undefined, isEtf: item.isEtf === "Y",
  });
}

async function loadStocks(environment: InvestmentEnvironment) {
  const cached = stockCache.get(environment);
  if (cached && cached.expiresAt > Date.now()) return cached.stocks;
  const token = await getAccessToken(environment);
  let stocks: Stock[];
  if (isDomestic(environment)) {
    stocks = [];
    for (const [index, market] of MARKET_TYPES.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_100));
      stocks.push(...await requestList(environment, token, market));
    }
  } else {
    stocks = await requestList(environment, token);
  }
  stocks = [...new Map(stocks.map((stock) => [`${stock.marketCode}:${stock.code}`, stock])).values()];
  stockCache.set(environment, { expiresAt: Date.now() + 10 * 60 * 1000, stocks });
  return stocks;
}

export async function GET(request: NextRequest) {
  const environment = request.nextUrl.searchParams.get("environment");
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!isInvestmentEnvironment(environment)) return NextResponse.json({ message: "지원하지 않는 투자 환경입니다." }, { status: 400 });
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
    const domestic = isDomestic(environment);
    const candidates = (await loadStocks(environment)).map((stock) => ({ source: stock, masked: anonymizeStock(stock, domestic) }));
    const results = candidates.filter(({ source, masked }) => source.code.toLocaleLowerCase().includes(normalized) || source.name.toLocaleLowerCase("ko-KR").includes(normalized) || source.englishName?.toLocaleLowerCase().includes(normalized) || masked.name.toLocaleLowerCase("ko-KR").includes(normalized)).sort((a, b) => rank(a.source) - rank(b.source) || a.source.code.localeCompare(b.source.code)).slice(0, 50).map(({ masked }) => masked);
    const safeQuery = /^[a-z0-9.-]+$/i.test(query) ? query : "검색어 비공개";
    return NextResponse.json({ category: domestic ? "domestic" : "overseas", trId: domestic ? "ka10099" : "usa10099", query: safeQuery, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "종목 검색 중 오류가 발생했습니다." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
