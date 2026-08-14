import { fetchAvailableQuantity, fetchOrderSnapshot, fetchUnfilledSells, findRecoveryCandidates, resolveOrderMarket, submitBrokerOrder, BrokerRejectedError, BrokerSafetyStoppedError } from "./kiwoom-orders.server";
import { appendOrderReasons, findActiveSell, findOrderByBrokerOrderNo, findOrderByRequestId, getPosition, importExternalSellOrder, makePositionKey, pausePosition, reserveOrder, updateOrder } from "./store.server";
import type { MockEnvironment } from "../api/kiwoom.server";
import type { OrderRecord, OrderSide, SellIntentSource, StrategySignal } from "./types";

export class ActiveSellConflictError extends Error {
  readonly activeOrder: OrderRecord;

  constructor(activeOrder: OrderRecord) {
    super("이 종목에는 이미 진행 중이거나 확인이 필요한 매도 주문이 있습니다.");
    this.activeOrder = activeOrder;
  }
}

export class CoordinatedOrderRejectedError extends Error {}
export class PositionPausedError extends Error {}
export class CoordinatedOrderUnknownError extends Error {
  readonly order: OrderRecord;

  constructor(message: string, order: OrderRecord) {
    super(message);
    this.order = order;
  }
}

export type CoordinatedOrderInput = {
  environment: MockEnvironment;
  requestId: string;
  side: OrderSide;
  source: SellIntentSource;
  code: string;
  marketCode?: string;
  quantity: number;
  orderType: "limit" | "market";
  price?: number;
  reasons?: string[];
  canSubmit?: () => boolean;
};

function pauseAfterUnsafeResult(order: OrderRecord, reason: string) {
  if (order.side === "sell") pausePosition(order.positionKey, reason);
}

export async function submitCoordinatedOrder(input: CoordinatedOrderInput) {
  const marketCode = await resolveOrderMarket(input.environment, input.code, input.marketCode);
  const duplicate = findOrderByRequestId(input.requestId);
  if (duplicate) return { order: duplicate, duplicatePrevented: true };
  if (input.side === "sell") {
    const positionKey = makePositionKey(input.environment, marketCode, input.code);
    const runtime = getPosition(positionKey);
    if (runtime?.paused) throw new PositionPausedError(runtime.pauseReason || "이 종목의 자동매도 안전 잠금이 유지되고 있습니다.");
    const localActive = findActiveSell(positionKey);
    if (localActive) {
      const activeOrder = input.source === "strategy" ? appendOrderReasons(localActive.id, input.reasons ?? []) : localActive;
      throw new ActiveSellConflictError(activeOrder);
    }
  }
  const reservation = reserveOrder({
    requestId: input.requestId,
    environment: input.environment,
    side: input.side,
    source: input.source,
    code: input.code,
    marketCode,
    reasons: input.reasons ?? [input.source === "manual" ? "사용자 직접 주문" : "자동 전략"],
    quantity: input.quantity,
  });
  if (reservation.kind === "conflict") throw new ActiveSellConflictError(reservation.order);
  if (reservation.kind === "duplicate") return { order: reservation.order, duplicatePrevented: true };
  let order = reservation.order;
  try {
    if (input.side === "sell") {
      const unfilled = await fetchUnfilledSells(input.environment, input.code, marketCode);
      const external = unfilled.filter((candidate) => !findOrderByBrokerOrderNo(input.environment, candidate.orderNo));
      if (external.length > 0) {
        order = updateOrder(order.id, { state: "rejected", message: "키움에 이미 미체결 매도 주문이 있어 새 주문을 보내지 않았습니다.", needsAttention: true });
        for (const candidate of external) {
          importExternalSellOrder({ environment: input.environment, code: candidate.code, marketCode: candidate.marketCode || marketCode, quantity: candidate.orderedQuantity, orderNo: candidate.orderNo, filledQuantity: candidate.filledQuantity, remainingQuantity: candidate.remainingQuantity, trId: candidate.trId });
        }
        const active = findActiveSell(makePositionKey(input.environment, marketCode, input.code));
        if (active) throw new ActiveSellConflictError(active);
        throw new CoordinatedOrderRejectedError("키움 미체결 매도 주문을 확인해야 합니다.");
      }
      const available = await fetchAvailableQuantity(input.environment, input.code, marketCode);
      if (available < input.quantity) throw new BrokerRejectedError(`매도 가능 수량은 ${available}주입니다.`);
    }
    order = updateOrder(order.id, { state: "submitting", message: "키움에 주문을 전송하는 중입니다." });
    const accepted = await submitBrokerOrder({ ...input, marketCode }, input.canSubmit);
    order = updateOrder(order.id, {
      state: "accepted",
      brokerOrderNo: accepted.orderNo,
      trId: accepted.trId,
      message: accepted.message,
      needsAttention: false,
    });
    return { order, duplicatePrevented: false };
  } catch (error) {
    if (error instanceof ActiveSellConflictError || error instanceof CoordinatedOrderRejectedError) throw error;
    if (error instanceof BrokerSafetyStoppedError) {
      updateOrder(order.id, { state: "rejected", message: error.message, needsAttention: false });
      throw new CoordinatedOrderRejectedError(error.message);
    }
    if (error instanceof BrokerRejectedError) {
      order = updateOrder(order.id, { state: "rejected", message: error.message, needsAttention: true });
      pauseAfterUnsafeResult(order, `주문 거절: ${error.message}`);
      throw new CoordinatedOrderRejectedError(error.message);
    }
    const message = error instanceof Error ? error.message : "주문 접수 여부를 확인할 수 없습니다.";
    order = updateOrder(order.id, { state: "unknown", message, needsAttention: true });
    pauseAfterUnsafeResult(order, "주문 접수 여부 불명확");
    throw new CoordinatedOrderUnknownError(message, order);
  }
}

export async function submitStrategySignals(input: { environment: MockEnvironment; code: string; marketCode: string; quantity: number; signals: StrategySignal[]; canSubmit?: () => boolean }) {
  const strategies = [...new Set(input.signals.map((signal) => signal.strategy))].sort();
  const generation = Math.max(...input.signals.map((signal) => signal.positionGeneration));
  const observedAt = input.signals.map((signal) => signal.observedAt).sort().at(-1) ?? new Date().toISOString();
  return submitCoordinatedOrder({
    environment: input.environment,
    requestId: `strategy:${input.environment}:${input.marketCode}:${input.code}:g${generation}:${strategies.join("+")}:${observedAt}`,
    side: "sell",
    source: "strategy",
    code: input.code,
    marketCode: input.marketCode,
    quantity: input.quantity,
    orderType: "market",
    reasons: input.signals.map((signal) => signal.reason),
    canSubmit: input.canSubmit,
  });
}

export async function reconcileOrder(order: OrderRecord) {
  if (!order.brokerOrderNo) {
    if (order.state !== "unknown" && order.state !== "manual-review") return order;
    const candidates = await findRecoveryCandidates({
      environment: order.environment,
      code: order.code,
      side: order.side,
      quantity: order.orderedQuantity,
      createdAt: order.createdAt,
    });
    if (candidates.length !== 1) {
      return updateOrder(order.id, {
        state: "manual-review",
        message: candidates.length === 0 ? "일치하는 주문을 찾지 못했습니다. 사용자 확인이 필요합니다." : "일치 후보가 여러 개여서 사용자 확인이 필요합니다.",
        needsAttention: true,
      });
    }
    order = updateOrder(order.id, { brokerOrderNo: candidates[0], message: "주문내역에서 주문번호를 복구했습니다." });
  }
  const snapshot = await fetchOrderSnapshot(order.environment, order.brokerOrderNo!, order.code, order.side);
  if (!snapshot) return order;
  const filledQuantity = Math.max(order.filledQuantity, snapshot.filledQuantity);
  const remainingQuantity = Math.max(0, order.orderedQuantity - filledQuantity);
  const state = order.state === "filled" || filledQuantity >= order.orderedQuantity
    ? "filled"
    : snapshot.state === "cancelled-partial" || snapshot.state === "manual-review"
      ? snapshot.state
      : filledQuantity > 0 ? "partial" : snapshot.state;
  const terminalUnsafe = state === "cancelled-partial" || state === "manual-review" || state === "rejected";
  const updated = updateOrder(order.id, {
    state,
    filledQuantity,
    remainingQuantity,
    message: snapshot.message,
    needsAttention: terminalUnsafe,
  });
  if (order.side === "sell" && snapshot.state === "filled") pauseAfterUnsafeResult(updated, "매도 체결 후 잔고 재동기화 또는 사용자 재개가 필요합니다.");
  if (order.source === "external" && (state === "filled" || state === "cancelled-partial")) {
    pauseAfterUnsafeResult(updated, "외부 직접 매도가 끝나 재개 확인이 필요합니다.");
  }
  if (state === "cancelled-partial") pauseAfterUnsafeResult(updated, "일부 체결 후 주문이 종료되었습니다.");
  if (state === "rejected") pauseAfterUnsafeResult(updated, "접수됐던 주문이 미체결 상태로 종료되었습니다.");
  return updated;
}

export function publicOrder(order: OrderRecord) {
  const status = order.state === "filled" ? "filled" : order.state === "partial" || order.state === "cancelled-partial" ? "partial" : "pending";
  return {
    orderNo: order.brokerOrderNo,
    requestId: order.requestId,
    environment: order.environment,
    side: order.side,
    code: order.code,
    trId: order.trId,
    marketCode: order.marketCode,
    state: order.state,
    status,
    label: order.message || (status === "filled" ? "체결 완료" : status === "partial" ? "일부 체결" : "체결 대기"),
    message: order.message,
    source: order.source,
    reasons: order.reasons,
    orderedQuantity: order.orderedQuantity,
    filledQuantity: order.filledQuantity,
    remainingQuantity: order.remainingQuantity,
    needsAttention: order.needsAttention,
  };
}
