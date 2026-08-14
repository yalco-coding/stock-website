import { loggedFetch as fetch } from "../external-api-logger.server";
import { getMockAccessToken, invalidateAccessToken, MOCK_DOMAIN, normalizeDomesticStockCode, resolveUsMarket, type MockEnvironment } from "../api/kiwoom.server";
import type { CandleInterval } from "../strategy-settings";
import { applyKiwoomBackoff, scheduleKiwoomTr } from "./rate-limiter.server";

const num = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;
const text = (value: unknown) => String(value ?? "").trim();

export class KiwoomQueryError extends Error {
  readonly code: number;
  readonly fatal: boolean;

  constructor(message: string, code: number, fatal: boolean) {
    super(message);
    this.code = code;
    this.fatal = fatal;
  }
}

async function query(input: {
  environment: MockEnvironment;
  path: string;
  trId: string;
  payload: Record<string, string>;
  priority: number;
  continuation?: { nextKey: string };
}) {
  return scheduleKiwoomTr(input.environment, input.trId, input.priority, async () => {
    const token = await getMockAccessToken(input.environment);
    const response = await fetch(`${MOCK_DOMAIN}${input.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "api-id": input.trId,
        authorization: `Bearer ${token}`,
        ...(input.continuation ? { "cont-yn": "Y", "next-key": input.continuation.nextKey } : {}),
      },
      body: JSON.stringify(input.payload),
      cache: "no-store",
    });
    let body: Record<string, unknown>;
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      throw new KiwoomQueryError("키움 조회 응답을 해석할 수 없습니다.", -1, false);
    }
    const code = num(body.return_code);
    if (!response.ok || code !== 0) {
      if (code === 8005) invalidateAccessToken(input.environment);
      if ([1700, 1701, 1702].includes(code)) applyKiwoomBackoff(input.environment, input.trId, 3_000);
      const inputError = code >= 1500 && code < 1600;
      if (inputError) console.error(`키움 ${input.trId} 입력 오류 ${code}: 자동 재시도하지 않습니다.`);
      throw new KiwoomQueryError(text(body.return_msg) || "키움 조회가 실패했습니다.", code, inputError || [8010, 8030, 8031, 8104].includes(code));
    }
    return {
      body,
      continuation: response.headers.get("cont-yn") === "Y" && response.headers.get("next-key")
        ? { nextKey: response.headers.get("next-key")! }
        : null,
    };
  });
}

export type BrokerPosition = {
  environment: MockEnvironment;
  code: string;
  marketCode: string;
  quantity: number;
  availableQuantity: number;
  averagePrice: number;
  currentPrice: number;
};

export async function fetchBrokerPositions(environment: MockEnvironment): Promise<BrokerPosition[]> {
  const domestic = environment === "mock-domestic";
  const result = await query({
    environment,
    path: domestic ? "/api/dostk/acnt" : "/api/us/acnt",
    trId: domestic ? "kt00018" : "ust21070",
    payload: domestic ? { qry_tp: "1", dmst_stex_tp: "KRX" } : { stex_tp: "", stk_cd: "" },
    priority: 90,
  });
  const rows = domestic
    ? result.body.acnt_evlt_remn_indv_tot as Record<string, unknown>[] | undefined
    : result.body.result_list as Record<string, unknown>[] | undefined;
  const token = domestic ? "" : await getMockAccessToken(environment);
  const positions: BrokerPosition[] = [];
  for (const row of rows ?? []) {
    const code = domestic ? normalizeDomesticStockCode(text(row.stk_cd).replace(/^[AJQ]/, "")) : text(row.stk_cd).toUpperCase();
    const quantity = num(domestic ? row.rmnd_qty : row.poss_qty);
    if (!code || quantity <= 0) continue;
    const marketCode = domestic ? "KRX" : await scheduleKiwoomTr(environment, "usa10098", 80, () => resolveUsMarket(code, token, environment));
    positions.push({
      environment,
      code,
      marketCode,
      quantity,
      availableQuantity: num(domestic ? row.trde_able_qty : row.sell_alowq),
      averagePrice: num(domestic ? row.pur_pric : row.frgn_stk_book_uv),
      currentPrice: Math.abs(num(domestic ? row.cur_prc : row.now_pric)),
    });
  }
  return positions;
}

export type ChartBar = { key: string; close: number; high: number };

const DOMESTIC_CHARTS = {
  minute: { trId: "ka10080", list: "stk_min_pole_chart_qry" },
  day: { trId: "ka10081", list: "stk_dt_pole_chart_qry" },
  week: { trId: "ka10082", list: "stk_stk_pole_chart_qry" },
  month: { trId: "ka10083", list: "stk_mth_pole_chart_qry" },
} as const;

const OVERSEAS_CHARTS = {
  minute: "usa06011",
  day: "usa06012",
  week: "usa06013",
  month: "usa06014",
  year: "usa06015",
  quarter: "usa06016",
} as const;

function ymd(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("-", "");
}

export async function fetchChartBars(input: {
  environment: MockEnvironment;
  code: string;
  marketCode: string;
  interval: CandleInterval;
  minimumCount: number;
}) {
  const domestic = input.environment === "mock-domestic";
  const intervalKind = input.interval.startsWith("minute:") ? "minute" : input.interval;
  const today = ymd(new Date(), domestic ? "Asia/Seoul" : "America/New_York");
  const domesticSpec = domestic ? DOMESTIC_CHARTS[intervalKind as keyof typeof DOMESTIC_CHARTS] : null;
  const trId = domestic ? domesticSpec!.trId : OVERSEAS_CHARTS[intervalKind as keyof typeof OVERSEAS_CHARTS];
  const payload = domestic
    ? {
        stk_cd: input.code,
        ...(intervalKind === "minute" ? { tic_scope: input.interval.split(":")[1] } : {}),
        upd_stkpc_tp: "1",
        base_dt: today,
      }
    : {
        stex_tp: input.marketCode,
        stk_cd: input.code,
        strt_dt: today,
        ...(intervalKind === "minute" ? { tic_scope: input.interval.split(":")[1] } : {}),
        upd_stkpc_tp: "1",
        exrt_appl_tp: "0",
      };
  const bars = new Map<string, ChartBar>();
  let continuation: { nextKey: string } | undefined;
  for (let page = 0; page < 20 && bars.size < input.minimumCount; page += 1) {
    const result = await query({
      environment: input.environment,
      path: domestic ? "/api/dostk/chart" : "/api/us/chart",
      trId,
      payload,
      priority: 10,
      continuation,
    });
    const rows = domestic
      ? result.body[domesticSpec!.list] as Record<string, unknown>[] | undefined
      : result.body.result_list as Record<string, unknown>[] | undefined;
    for (const row of rows ?? []) {
      const key = text(intervalKind === "minute" ? row.cntr_tm : domestic ? row.dt : row.dt || row.bus_dt);
      const close = Math.abs(num(row.cur_prc));
      const high = Math.abs(num(row.high_pric)) || close;
      if (key && close > 0) bars.set(key, { key, close, high });
    }
    continuation = result.continuation ?? undefined;
    if (!continuation) break;
  }
  return [...bars.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function localClockParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}${part("month")}${part("day")}`, hour: Number(part("hour")), minute: Number(part("minute")) };
}

function sameCalendarWeek(left: string, right: string) {
  const parse = (value: string) => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
  const weekStart = (date: Date) => {
    const day = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
  };
  return weekStart(parse(left)) === weekStart(parse(right));
}

export function completedChartBars(bars: ChartBar[], interval: CandleInterval, environment: MockEnvironment, now = new Date()) {
  const timeZone = environment === "mock-domestic" ? "Asia/Seoul" : "America/New_York";
  const clock = localClockParts(now, timeZone);
  const close = environment === "mock-domestic" ? { hour: 15, minute: 30 } : { hour: 16, minute: 0 };
  const afterClose = clock.hour * 60 + clock.minute >= close.hour * 60 + close.minute;
  return bars.filter((bar) => {
    if (interval.startsWith("minute:")) {
      if (bar.key.slice(0, 8) < clock.date) return true;
      if (bar.key.slice(0, 8) > clock.date) return false;
      const intervalMinutes = Number(interval.split(":")[1]);
      const candleMinute = Number(bar.key.slice(8, 10)) * 60 + Number(bar.key.slice(10, 12));
      return candleMinute + intervalMinutes <= clock.hour * 60 + clock.minute;
    }
    const date = bar.key.slice(0, 8);
    if (interval === "day") return date < clock.date || (date === clock.date && afterClose);
    if (interval === "week") return !sameCalendarWeek(date, clock.date);
    if (interval === "month") return date.slice(0, 6) < clock.date.slice(0, 6);
    if (interval === "year") return date.slice(0, 4) < clock.date.slice(0, 4);
    const quarter = (value: string) => `${value.slice(0, 4)}${Math.floor((Number(value.slice(4, 6)) - 1) / 3) + 1}`;
    return quarter(date) < quarter(clock.date);
  });
}
