import { loggedFetch as fetch } from "../external-api-logger.server";
import { getMockAccessToken, invalidateAccessToken, MOCK_DOMAIN, normalizeDomesticStockCode, resolveUsMarket, type MockEnvironment } from "../api/kiwoom.server";
import { applyKiwoomBackoff, scheduleKiwoomTr } from "./rate-limiter.server";
import type { BrokerOrderSnapshot, OrderSide } from "./types";

const num = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;
const text = (value: unknown) => String(value ?? "").trim();

export class BrokerRejectedError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

export class BrokerUncertainError extends Error {}
export class BrokerSafetyStoppedError extends Error {}

async function brokerPost(environment: MockEnvironment, path: string, trId: string, payload: Record<string, string>, priority: number, beforeSend?: () => boolean) {
  return scheduleKiwoomTr(environment, trId, priority, async () => {
    if (beforeSend && !beforeSend()) throw new BrokerSafetyStoppedError("실시간 연결이 끊겨 주문을 보내지 않았습니다.");
    const token = await getMockAccessToken(environment);
    let response: Response;
    try {
      response = await fetch(`${MOCK_DOMAIN}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
    } catch (error) {
      throw new BrokerUncertainError(error instanceof Error ? error.message : "키움 서버와 통신 결과를 확인할 수 없습니다.");
    }
    let body: Record<string, unknown>;
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      throw new BrokerUncertainError("키움 응답 본문을 확인할 수 없습니다.");
    }
    const returnCode = num(body.return_code);
    if (!response.ok && (body.return_code == null || returnCode === 0)) {
      throw new BrokerUncertainError(text(body.return_msg) || "키움 주문 서버의 처리 결과를 확인할 수 없습니다.");
    }
    if (returnCode !== 0) {
      if (returnCode === 8005) invalidateAccessToken(environment);
      if ([1700, 1701, 1702].includes(returnCode)) applyKiwoomBackoff(environment, trId, 3_000);
      if (returnCode >= 1500 && returnCode < 1600) console.error(`키움 ${trId} 입력 오류 ${returnCode}: 자동 재시도하지 않습니다.`);
      throw new BrokerRejectedError(text(body.return_msg) || "키움에서 요청을 거절했습니다.", returnCode);
    }
    return body;
  });
}

export async function resolveOrderMarket(environment: MockEnvironment, code: string, marketCode?: string) {
  if (environment === "mock-domestic") return "KRX";
  if (marketCode && ["NA", "ND", "NY"].includes(marketCode)) return marketCode;
  return resolveUsMarket(code, await getMockAccessToken(environment), environment);
}

export async function fetchAvailableQuantity(environment: MockEnvironment, code: string, marketCode: string) {
  const domestic = environment === "mock-domestic";
  const trId = domestic ? "kt00018" : "ust21070";
  const body = await brokerPost(environment, domestic ? "/api/dostk/acnt" : "/api/us/acnt", trId,
    domestic ? { qry_tp: "1", dmst_stex_tp: marketCode } : { stex_tp: marketCode, stk_cd: code }, 90);
  const rows = domestic
    ? body.acnt_evlt_remn_indv_tot as Record<string, unknown>[] | undefined
    : body.result_list as Record<string, unknown>[] | undefined;
  const position = (rows ?? []).find((row) => domestic
    ? normalizeDomesticStockCode(text(row.stk_cd).replace(/^[AJQ]/, "")) === normalizeDomesticStockCode(code)
    : text(row.stk_cd).toUpperCase() === code.toUpperCase());
  return num(domestic ? position?.trde_able_qty : position?.sell_alowq);
}

export type SubmitBrokerOrderInput = {
  environment: MockEnvironment;
  side: OrderSide;
  code: string;
  marketCode: string;
  quantity: number;
  orderType: "limit" | "market";
  price?: number;
};

export async function submitBrokerOrder(input: SubmitBrokerOrderInput, beforeSend?: () => boolean) {
  const domestic = input.environment === "mock-domestic";
  const trId = domestic
    ? input.side === "sell" ? "kt10001" : "kt10000"
    : input.side === "sell" ? "ust20001" : "ust20000";
  const overseasPrice = input.orderType === "limit"
    ? Number(input.price) < 1 ? Number(input.price).toFixed(4) : Number(input.price).toFixed(2)
    : "";
  const payload: Record<string, string> = domestic
    ? {
        dmst_stex_tp: input.marketCode,
        stk_cd: input.code,
        ord_qty: String(input.quantity),
        ord_uv: input.orderType === "limit" ? String(input.price) : "",
        trde_tp: input.orderType === "limit" ? "0" : "3",
        cond_uv: "",
      }
    : input.side === "sell"
      ? { stk_cd: input.code, stex_tp: input.marketCode, ord_qty: String(input.quantity), ord_uv: overseasPrice, stop_pric: "", trde_tp: input.orderType === "limit" ? "00" : "03" }
      : { stk_cd: input.code, stex_tp: input.marketCode, ord_qty: String(input.quantity), ord_uv: overseasPrice, trde_tp: input.orderType === "limit" ? "00" : "03" };
  const body = await brokerPost(input.environment, domestic ? "/api/dostk/ordr" : "/api/us/ordr", trId, payload, 100, beforeSend);
  const orderNo = text(body.ord_no);
  if (!orderNo) throw new BrokerUncertainError("키움 응답에 주문번호가 없어 접수 여부를 확인해야 합니다.");
  return { orderNo, trId, message: text(body.return_msg) || `${input.side === "sell" ? "매도" : "매수"} 주문이 접수되었습니다.` };
}

function statusFromQuantities(orderNo: string, orderedQuantity: number, filledQuantity: number, remainingQuantity: number, statusText: string): BrokerOrderSnapshot {
  const normalizedOrdered = Math.max(orderedQuantity, filledQuantity + remainingQuantity);
  if (remainingQuantity === 0 && filledQuantity >= normalizedOrdered && normalizedOrdered > 0) {
    return { orderNo, orderedQuantity: normalizedOrdered, filledQuantity, remainingQuantity: 0, state: "filled", message: statusText || "체결 완료" };
  }
  if (remainingQuantity === 0 && filledQuantity > 0) {
    return { orderNo, orderedQuantity: normalizedOrdered, filledQuantity, remainingQuantity: 0, state: "cancelled-partial", message: statusText || "일부 체결 후 종료" };
  }
  if (remainingQuantity === 0 && filledQuantity === 0 && normalizedOrdered > 0) {
    return { orderNo, orderedQuantity: normalizedOrdered, filledQuantity: 0, remainingQuantity: normalizedOrdered, state: "rejected", message: statusText || "미체결 종료" };
  }
  if (filledQuantity > 0) {
    return { orderNo, orderedQuantity: normalizedOrdered, filledQuantity, remainingQuantity, state: "partial", message: statusText || "일부 체결" };
  }
  return { orderNo, orderedQuantity: normalizedOrdered, filledQuantity: 0, remainingQuantity, state: "accepted", message: statusText || "접수" };
}

export async function fetchOrderSnapshot(environment: MockEnvironment, orderNo: string, code: string, side: OrderSide) {
  const domestic = environment === "mock-domestic";
  const trId = domestic ? "kt00007" : "ust21510";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: domestic ? "Asia/Seoul" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replaceAll("-", "");
  const body = await brokerPost(environment, domestic ? "/api/dostk/acnt" : "/api/us/acnt", trId,
    domestic
      ? { ord_dt: today, qry_tp: "1", stk_bond_tp: "0", sell_tp: side === "sell" ? "1" : "2", stk_cd: code, fr_ord_no: "", dmst_stex_tp: "KRX" }
      : { slby_tp: side === "sell" ? "1" : "2", stex_tp: "", stk_cd: code }, 95);
  const rows = domestic
    ? body.acnt_ord_cntr_prps_dtl as Record<string, unknown>[] | undefined
    : body.result_list as Record<string, unknown>[] | undefined;
  const row = (rows ?? []).find((candidate) => text(candidate.ord_no) === orderNo);
  if (!row) return null;
  return statusFromQuantities(orderNo, num(row.ord_qty), num(row.cntr_qty), num(domestic ? row.ord_remnq : row.ord_remnq), text(domestic ? row.ord_stt : row.ord_stat));
}

export type UnfilledSell = { orderNo: string; code: string; marketCode: string; orderedQuantity: number; filledQuantity: number; remainingQuantity: number; trId: string };

export async function fetchUnfilledSells(environment: MockEnvironment, code = "", marketCode = "") {
  const domestic = environment === "mock-domestic";
  const trId = domestic ? "ka10075" : "ust21050";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: domestic ? "Asia/Seoul" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replaceAll("-", "");
  const body = await brokerPost(environment, domestic ? "/api/dostk/acnt" : "/api/us/acnt", trId,
    domestic
      ? { all_stk_tp: "0", trde_tp: "1", stk_cd: code, stex_tp: "0" }
      : { ord_dt: today, slby_tp: "1", stex_tp: marketCode, stk_cd: code }, 98);
  const rows = domestic ? body.oso as Record<string, unknown>[] | undefined : body.result_list as Record<string, unknown>[] | undefined;
  return (rows ?? []).map((row): UnfilledSell => ({
    orderNo: text(row.ord_no),
    code: domestic ? normalizeDomesticStockCode(text(row.stk_cd).replace(/^[AJQ]/, "")) : text(row.stk_cd).toUpperCase(),
    marketCode: domestic ? "KRX" : text(row.stex_tp || marketCode),
    orderedQuantity: num(row.ord_qty),
    filledQuantity: num(row.cntr_qty),
    remainingQuantity: num(domestic ? row.oso_qty : row.ord_remnq),
    trId,
  })).filter((order) => order.orderNo && order.remainingQuantity > 0);
}

export async function findRecoveryCandidates(input: { environment: MockEnvironment; code: string; side: OrderSide; quantity: number; createdAt: string }) {
  const domestic = input.environment === "mock-domestic";
  const trId = domestic ? "kt00007" : "ust21510";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: domestic ? "Asia/Seoul" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replaceAll("-", "");
  const body = await brokerPost(input.environment, domestic ? "/api/dostk/acnt" : "/api/us/acnt", trId,
    domestic
      ? { ord_dt: today, qry_tp: "1", stk_bond_tp: "0", sell_tp: input.side === "sell" ? "1" : "2", stk_cd: input.code, fr_ord_no: "", dmst_stex_tp: "KRX" }
      : { slby_tp: input.side === "sell" ? "1" : "2", stex_tp: "", stk_cd: input.code }, 99);
  const rows = domestic ? body.acnt_ord_cntr_prps_dtl as Record<string, unknown>[] | undefined : body.result_list as Record<string, unknown>[] | undefined;
  const createdTime = new Date(input.createdAt).getTime();
  return (rows ?? []).filter((row) => {
    if (num(row.ord_qty) !== input.quantity || !text(row.ord_no)) return false;
    const orderTime = text(row.ord_tm).replace(/\D/g, "").slice(0, 6);
    if (orderTime.length !== 6) return true;
    const createdParts = new Intl.DateTimeFormat("en-US", { timeZone: domestic ? "Asia/Seoul" : "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(createdTime));
    const createdPart = (type: Intl.DateTimeFormatPartTypes) => Number(createdParts.find((part) => part.type === type)?.value ?? 0);
    const createdSeconds = createdPart("hour") * 3_600 + createdPart("minute") * 60 + createdPart("second");
    const candidateSeconds = Number(orderTime.slice(0, 2)) * 3_600 + Number(orderTime.slice(2, 4)) * 60 + Number(orderTime.slice(4, 6));
    return Math.abs(candidateSeconds - createdSeconds) <= 10 * 60;
  }).map((row) => text(row.ord_no));
}
