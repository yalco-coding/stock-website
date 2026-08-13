import { getMockAccessToken, MOCK_DOMAIN, normalizeDomesticStockCode, type MockEnvironment } from "../kiwoom.server";
import { sendTelegramNotificationOnce } from "../../telegram.server";
import { loggedFetch as fetch } from "../../external-api-logger.server";

export type OrderSide = "buy" | "sell";
export type TrackedOrder = {
  environment: MockEnvironment;
  side: OrderSide;
  orderNo: string;
  code: string;
  marketCode: string;
  orderedQuantity: number;
  baselineQuantity: number;
};
type OrderIdentity = Omit<TrackedOrder, "orderedQuantity" | "baselineQuantity">;

export type OrderStatus = {
  trId: string;
  status: "pending" | "partial" | "filled";
  label: string;
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
};

const POLL_INTERVAL_MS = 5_000;
const MONITOR_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const num = (value: unknown) => Number(String(value ?? "0").replace(/,/g, "")) || 0;
const monitorKey = (order: TrackedOrder) => `${order.environment}:${order.side}:${order.orderNo}`;
type HoldingsSnapshot = { trId: string; quantities: Map<string, number> };
type SnapshotEntry = { createdAt: number; result: Promise<HoldingsSnapshot> };

const globalMonitors = globalThis as typeof globalThis & {
  __kiwoomHoldingMonitors?: Map<string, ReturnType<typeof setTimeout>>;
  __kiwoomHoldingSnapshots?: Map<MockEnvironment, SnapshotEntry>;
  __kiwoomTrackedOrders?: Map<string, TrackedOrder>;
  __kiwoomHoldingMonitorVersion?: number;
};
const monitors = globalMonitors.__kiwoomHoldingMonitors ??= new Map();
const snapshots = globalMonitors.__kiwoomHoldingSnapshots ??= new Map();
const trackedOrders = globalMonitors.__kiwoomTrackedOrders ??= new Map();
const MONITOR_VERSION = 1;
if (globalMonitors.__kiwoomHoldingMonitorVersion !== MONITOR_VERSION) {
  for (const timer of monitors.values()) clearTimeout(timer);
  monitors.clear();
  snapshots.clear();
  trackedOrders.clear();
  globalMonitors.__kiwoomHoldingMonitorVersion = MONITOR_VERSION;
}

async function fetchHoldings(environment: MockEnvironment): Promise<HoldingsSnapshot> {
  const domestic = environment === "mock-domestic";
  const token = await getMockAccessToken(environment);
  const trId = domestic ? "kt00018" : "ust21070";
  const response = await fetch(`${MOCK_DOMAIN}${domestic ? "/api/dostk/acnt" : "/api/us/acnt"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "api-id": trId, authorization: `Bearer ${token}` },
    body: JSON.stringify(domestic ? { qry_tp: "1", dmst_stex_tp: "KRX" } : { stex_tp: "", stk_cd: "" }),
    cache: "no-store",
  });
  const body = await response.json() as Record<string, unknown> & { return_msg?: string; acnt_evlt_remn_indv_tot?: Record<string, unknown>[]; result_list?: Record<string, unknown>[] };
  if (!response.ok || num(body.return_code) !== 0) throw new Error(body.return_msg || "보유종목을 확인하지 못했습니다.");
  const rows = domestic ? body.acnt_evlt_remn_indv_tot ?? [] : body.result_list ?? [];
  const quantities = new Map(rows.map((row) => [
    domestic ? normalizeDomesticStockCode(String(row.stk_cd ?? "").replace(/^[AJQ]/, "")) : String(row.stk_cd ?? ""),
    num(domestic ? row.rmnd_qty : row.poss_qty),
  ]));
  return { trId, quantities };
}

function getHoldings(environment: MockEnvironment): Promise<HoldingsSnapshot> {
  const now = Date.now();
  const cached = snapshots.get(environment);
  if (cached && now - cached.createdAt < POLL_INTERVAL_MS) return cached.result;
  const result = fetchHoldings(environment);
  snapshots.set(environment, { createdAt: now, result });
  void result.catch(() => { if (snapshots.get(environment)?.result === result) snapshots.delete(environment); });
  return result;
}

export async function getPositionQuantity(environment: MockEnvironment, code: string): Promise<number> {
  const snapshot = await fetchHoldings(environment);
  return snapshot.quantities.get(environment === "mock-domestic" ? normalizeDomesticStockCode(code) : code) ?? 0;
}

export async function getOrderStatus(identity: OrderIdentity): Promise<OrderStatus> {
  const order = trackedOrders.get(monitorKey(identity as TrackedOrder));
  if (!order) return { trId: identity.environment === "mock-domestic" ? "kt00018" : "ust21070", status: "pending", label: "체결 감시 준비 중", orderedQuantity: 0, filledQuantity: 0, remainingQuantity: 0 };
  const code = order.environment === "mock-domestic" ? normalizeDomesticStockCode(order.code) : order.code;
  const { trId, quantities } = await getHoldings(order.environment);
  const currentQuantity = quantities.get(code) ?? 0;
  const changedQuantity = order.side === "buy" ? currentQuantity - order.baselineQuantity : order.baselineQuantity - currentQuantity;
  const filledQuantity = Math.min(Math.max(changedQuantity, 0), order.orderedQuantity);
  const remainingQuantity = Math.max(order.orderedQuantity - filledQuantity, 0);
  const status = remainingQuantity === 0 ? "filled" : filledQuantity > 0 ? "partial" : "pending";

  if (status === "filled") {
    const sideLabel = order.side === "sell" ? "매도" : "매수";
    await sendTelegramNotificationOnce(
      monitorKey(order),
      order.side === "sell" ? "sellFilled" : "buyFilled",
      `✅ ${sideLabel} 체결 감지\n종목코드: ${code}\n수량: ${filledQuantity}주\n주문번호: ${order.orderNo}`,
    );
  }
  return { trId, status, label: status === "filled" ? "체결 완료" : status === "partial" ? "일부 체결" : "체결 대기", orderedQuantity: order.orderedQuantity, filledQuantity, remainingQuantity };
}

export function startOrderMonitor(order: TrackedOrder): void {
  const key = monitorKey(order);
  trackedOrders.set(key, order);
  if (monitors.has(key)) return;
  const expiresAt = Date.now() + MONITOR_LIFETIME_MS;
  const poll = async () => {
    try {
      if ((await getOrderStatus(order)).status === "filled") { monitors.delete(key); return; }
    } catch (error) { console.error(`주문 ${order.orderNo} 보유수량 감시에 실패했습니다.`, error); }
    if (Date.now() >= expiresAt) { monitors.delete(key); return; }
    const timer = setTimeout(poll, POLL_INTERVAL_MS);
    timer.unref?.();
    monitors.set(key, timer);
  };
  const timer = setTimeout(poll, POLL_INTERVAL_MS);
  timer.unref?.();
  monitors.set(key, timer);
}
