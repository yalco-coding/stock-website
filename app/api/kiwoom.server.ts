export type InvestmentEnvironment = "real-domestic" | "real-overseas" | "mock-domestic" | "mock-overseas";
export type MockEnvironment = Extract<InvestmentEnvironment, `mock-${string}`>;
type TokenEntry = { value: string; expiresAt: number };

export const MOCK_DOMAIN = "https://mockapi.kiwoom.com";
export const REAL_DOMAIN = "https://api.kiwoom.com";
const tokenCache = new Map<InvestmentEnvironment, TokenEntry>();
const usMarketCache = new Map<string, string>();

export function isInvestmentEnvironment(value: string | null): value is InvestmentEnvironment {
  return value === "real-domestic" || value === "real-overseas" || value === "mock-domestic" || value === "mock-overseas";
}

export function isDomestic(environment: InvestmentEnvironment) {
  return environment.endsWith("domestic");
}

export function getApiDomain(environment: InvestmentEnvironment) {
  return environment.startsWith("real-") ? REAL_DOMAIN : MOCK_DOMAIN;
}

function credentials(environment: InvestmentEnvironment) {
  if (environment.startsWith("real-")) return { appkey: process.env.KRA_REAL_APP_KEY, secretkey: process.env.KRA_REAL_APP_SECRET };
  return environment === "mock-domestic"
    ? { appkey: process.env.KRA_MOCK_DOMESTIC_APP_KEY, secretkey: process.env.KRA_MOCK_DOMESTIC_APP_SECRET }
    : { appkey: process.env.KRA_MOCK_OVERSEAS_APP_KEY, secretkey: process.env.KRA_MOCK_OVERSEAS_APP_SECRET };
}

export async function getAccessToken(environment: InvestmentEnvironment) {
  const cached = tokenCache.get(environment);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const auth = credentials(environment);
  if (!auth.appkey || !auth.secretkey) throw new Error(`선택한 ${environment.startsWith("real-") ? "실투자" : "모의투자"} 환경의 인증정보가 설정되지 않았습니다.`);
  const response = await fetch(`${getApiDomain(environment)}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": "au10001" }, body: JSON.stringify({ grant_type: "client_credentials", appkey: auth.appkey, secretkey: auth.secretkey }), cache: "no-store" });
  const body = await response.json() as { token?: string; expires_dt?: string; return_msg?: string };
  if (!response.ok || !body.token) throw new Error(body.return_msg || "키움 인증에 실패했습니다.");
  const expiresAt = body.expires_dt ? new Date(`${body.expires_dt.slice(0,4)}-${body.expires_dt.slice(4,6)}-${body.expires_dt.slice(6,8)}T${body.expires_dt.slice(8,10)}:${body.expires_dt.slice(10,12)}:${body.expires_dt.slice(12,14)}+09:00`).getTime() : Date.now() + 23 * 60 * 60 * 1000;
  tokenCache.set(environment, { value: body.token, expiresAt });
  return body.token;
}

export const getMockAccessToken = (environment: MockEnvironment) => getAccessToken(environment);

export async function resolveUsMarket(code: string, token: string, environment: InvestmentEnvironment = "mock-overseas") {
  const cacheKey = `${environment}:${code}`;
  const cached = usMarketCache.get(cacheKey);
  if (cached) return cached;
  const response = await fetch(`${getApiDomain(environment)}/api/us/stkinfo`, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": "usa10098", authorization: `Bearer ${token}` }, body: JSON.stringify({ stk_cd: code }), cache: "no-store" });
  const body = await response.json() as { return_code?: number; return_msg?: string; list?: { stex_tp?: string; stk_cd?: string }[] };
  if (!response.ok || Number(body.return_code ?? 0) !== 0) throw new Error(body.return_msg || "미국주식 거래소를 확인하지 못했습니다.");
  const marketCode = body.list?.find((item) => item.stk_cd === code)?.stex_tp;
  if (!marketCode || !["NA", "ND", "NY"].includes(marketCode)) throw new Error("지원하는 미국 거래소 종목이 아닙니다.");
  usMarketCache.set(cacheKey, marketCode);
  return marketCode;
}
