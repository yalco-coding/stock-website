import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateDeadCross,
  evaluateSlTp,
  evaluateTrailingStop,
  isWithinStrategyWindow,
  mergeStrategySignals,
  profitBasisPoints,
} from "../app/strategy-engine/evaluators.ts";
import { completedChartBars } from "../app/strategy-engine/kiwoom-market.server.ts";
import { normalizeRealtimePrice, parseRealtimeMessage } from "../app/strategy-engine/realtime-events.ts";

const slTpSettings = { enabled: true, startTime: "09:00", endTime: "15:30", takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] };

test("SL/TP compares profit at 0.01 percent precision", () => {
  assert.equal(profitBasisPoints(100, 104.994), 499);
  assert.equal(profitBasisPoints(100, 104.995), 500);
  const signal = evaluateSlTp({ settings: slTpSettings, averagePrice: 100, price: { price: 104.995, observedAt: "2026-08-14T01:00:00.000Z" }, positionKey: "mock-domestic:KRX:005930", positionGeneration: 1 });
  assert.equal(signal?.strategy, "slTp");
});

test("New York regular-session checks follow daylight saving time", () => {
  assert.equal(isWithinStrategyWindow(new Date("2026-07-06T13:30:00.000Z"), "overseas", "09:30", "16:00"), true);
  assert.equal(isWithinStrategyWindow(new Date("2026-01-05T14:30:00.000Z"), "overseas", "09:30", "16:00"), true);
  assert.equal(isWithinStrategyWindow(new Date("2026-07-05T14:00:00.000Z"), "overseas", "09:30", "16:00"), false);
});

test("Trailing stop preserves activation and peak before emitting one signal", () => {
  const settings = { enabled: true, startTime: "09:00", endTime: "15:30", activationProfitPercent: 5, drawdownPercent: 2, excludedStocks: [] };
  const activated = evaluateTrailingStop({ settings, averagePrice: 100, price: { price: 106, observedAt: "2026-08-14T01:00:00.000Z" }, positionKey: "p", positionGeneration: 3, activated: false, peak: null });
  assert.equal(activated.activated, true);
  assert.equal(activated.peak, 106);
  assert.equal(activated.signal, null);
  const raised = evaluateTrailingStop({ settings, averagePrice: 100, price: { price: 110, observedAt: "2026-08-14T01:01:00.000Z" }, positionKey: "p", positionGeneration: 3, activated: activated.activated, peak: activated.peak });
  const dropped = evaluateTrailingStop({ settings, averagePrice: 100, price: { price: 107.8, observedAt: "2026-08-14T01:02:00.000Z" }, positionKey: "p", positionGeneration: 3, activated: raised.activated, peak: raised.peak });
  assert.equal(dropped.signal?.strategy, "trailingStop");
});

test("Dead cross ignores bootstrap and the same candle, then emits only on a new completed candle", () => {
  const settings = { enabled: true, startTime: "09:00", endTime: "15:30", candleInterval: "minute:5", shortPeriod: 2, longPeriod: 3, excludedStocks: [] };
  const candles = [{ key: "20260814090000", close: 10 }, { key: "20260814090500", close: 10 }, { key: "20260814091000", close: 10 }, { key: "20260814091500", close: 5 }];
  const bootstrap = evaluateDeadCross({ settings, completedCandles: candles.slice(0, 3), positionKey: "p", positionGeneration: 1, previousCandleKey: null, previousRelation: null, observedAt: "2026-08-14T00:15:00.000Z" });
  assert.equal(bootstrap.signal, null);
  const crossed = evaluateDeadCross({ settings, completedCandles: candles, positionKey: "p", positionGeneration: 1, previousCandleKey: bootstrap.candleKey, previousRelation: bootstrap.relation, observedAt: "2026-08-14T00:20:00.000Z" });
  assert.equal(crossed.signal?.strategy, "deadCross");
  const repeated = evaluateDeadCross({ settings, completedCandles: candles, positionKey: "p", positionGeneration: 1, previousCandleKey: crossed.candleKey, previousRelation: crossed.relation, observedAt: "2026-08-14T00:21:00.000Z" });
  assert.equal(repeated.signal, null);
});

test("Incomplete candles are removed before strategy evaluation", () => {
  const bars = [
    { key: "20260814090000", close: 100, high: 101 },
    { key: "20260814090500", close: 99, high: 100 },
    { key: "20260814091000", close: 98, high: 99 },
  ];
  const completed = completedChartBars(bars, "minute:5", "mock-domestic", new Date("2026-08-14T00:12:00.000Z"));
  assert.deepEqual(completed.map((bar) => bar.key), ["20260814090000", "20260814090500"]);
});

test("Realtime price validation rejects damaged, reversed, and wrong-exchange events", () => {
  assert.equal(parseRealtimeMessage("not json"), null);
  assert.deepEqual(parseRealtimeMessage('{"trnm":"PING"}'), { trnm: "PING" });
  const entry = { type: "0B", item: "005930", values: { "10": "-70100", "20": "101500", "9081": "KRX" } };
  const valid = normalizeRealtimePrice({ environment: "mock-domestic", entry, expectedCode: "005930", expectedMarketCode: "KRX", localDate: "20260814" });
  assert.deepEqual(valid, { code: "005930", price: 70100, eventKey: "20260814101500" });
  assert.equal(normalizeRealtimePrice({ environment: "mock-domestic", entry, expectedCode: "005930", expectedMarketCode: "KRX", localDate: "20260814", previousEventKey: "20260814101500" }), null);
  assert.equal(normalizeRealtimePrice({ environment: "mock-overseas", entry: { type: "FE", item: "NVDA", stexTp: "NY", values: { "10": "+198.5", "20": "101500", "22": "20260814" } }, expectedCode: "NVDA", expectedMarketCode: "ND", localDate: "20260814" }), null);
});

test("Three simultaneous strategy reasons merge into one signal collection", () => {
  const common = { positionKey: "mock-domestic:KRX:005930", positionGeneration: 4, observedAt: "2026-08-14T01:00:00.000Z" };
  const merged = mergeStrategySignals([
    { ...common, strategy: "slTp", reason: "익절" },
    { ...common, strategy: "trailingStop", reason: "고점 하락" },
    { ...common, strategy: "deadCross", reason: "교차" },
    { ...common, strategy: "slTp", reason: "익절" },
  ]);
  assert.deepEqual(merged.map((signal) => signal.strategy), ["slTp", "trailingStop", "deadCross"]);
});

test("SQLite unique guard allows only one active sell among 100 simultaneous intents", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strategy-ledger-"));
  process.env.STRATEGY_RUNTIME_DB_PATH = path.join(directory, "runtime.sqlite");
  const store = await import(`../app/strategy-engine/store.server.ts?test=${Date.now()}`);
  let openStore = store;
  try {
    const attempts = await Promise.all(Array.from({ length: 100 }, async (_, index) => store.reserveOrder({
      requestId: `request-${index}`,
      environment: "mock-domestic",
      side: "sell",
      source: "strategy",
      code: "005930",
      marketCode: "KRX",
      reasons: ["동시 신호"],
      quantity: 3,
    })));
    assert.equal(attempts.filter((attempt) => attempt.kind === "created").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.kind === "conflict").length, 99);
    const created = attempts.find((attempt) => attempt.kind === "created").order;
    const duplicate = store.reserveOrder({ requestId: created.requestId, environment: "mock-domestic", side: "sell", source: "manual", code: "005930", marketCode: "KRX", reasons: ["재요청"], quantity: 3 });
    assert.equal(duplicate.kind, "duplicate");
    store.updateOrder(created.id, { state: "unknown", needsAttention: true });
    assert.equal(store.reserveOrder({ requestId: "blocked-by-unknown", environment: "mock-domestic", side: "sell", source: "manual", code: "005930", marketCode: "KRX", reasons: [], quantity: 3 }).kind, "conflict");
    store.updateOrder(created.id, { state: "filled", filledQuantity: 3, remainingQuantity: 0 });
    assert.equal(store.reserveOrder({ requestId: "after-filled", environment: "mock-domestic", side: "sell", source: "manual", code: "005930", marketCode: "KRX", reasons: [], quantity: 3 }).kind, "created");
    store.pausePosition("mock-domestic:KRX:005930", "일부 체결 확인 필요");
    const coordinator = await import(`../app/strategy-engine/order-coordinator.server.ts?test=${Date.now()}`);
    await assert.rejects(
      coordinator.submitCoordinatedOrder({ environment: "mock-domestic", requestId: "paused-order", side: "sell", source: "manual", code: "005930", marketCode: "KRX", quantity: 1, orderType: "market" }),
      coordinator.PositionPausedError,
    );
    store.closeStrategyDatabase();
    openStore = null;
    const restarted = await import(`../app/strategy-engine/store.server.ts?restart=${Date.now()}`);
    openStore = restarted;
    assert.equal(restarted.findOrderByRequestId(created.requestId)?.state, "filled");
    assert.equal(restarted.reserveOrder({ requestId: created.requestId, environment: "mock-domestic", side: "sell", source: "manual", code: "005930", marketCode: "KRX", reasons: [], quantity: 3 }).kind, "duplicate");
  } finally {
    openStore?.closeStrategyDatabase();
    delete process.env.STRATEGY_RUNTIME_DB_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});
