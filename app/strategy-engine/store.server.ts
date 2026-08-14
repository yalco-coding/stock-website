import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { normalizeDomesticStockCode, type MockEnvironment } from "../api/kiwoom.server";
import type { EngineHealth, EngineState, OrderRecord, OrderSide, OrderState, PositionGeneration, SellIntentSource, StrategySignal } from "./types";

const ACTIVE_STATES = ["prepared", "submitting", "accepted", "partial", "unknown", "manual-review"] as const;
const dataDirectory = path.join(process.cwd(), ".data");
const productionBuild = process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const databasePath = process.env.STRATEGY_RUNTIME_DB_PATH || (productionBuild ? ":memory:" : path.join(dataDirectory, "strategy-runtime.sqlite"));

type SqliteGlobal = typeof globalThis & { __strategyRuntimeDatabase?: DatabaseSync; __strategyRuntimeRecovered?: boolean };
const globalDatabase = globalThis as SqliteGlobal;

function createDatabase() {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS order_intents (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      position_key TEXT NOT NULL,
      environment TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      source TEXT NOT NULL CHECK (source IN ('manual', 'strategy', 'external')),
      code TEXT NOT NULL,
      market_code TEXT NOT NULL,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity >= 0),
      filled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
      remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
      state TEXT NOT NULL,
      broker_order_no TEXT,
      tr_id TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      needs_attention INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS order_intents_active_sell_position
      ON order_intents(position_key)
      WHERE side = 'sell' AND state IN ('prepared', 'submitting', 'accepted', 'partial', 'unknown', 'manual-review');
    CREATE UNIQUE INDEX IF NOT EXISTS order_intents_broker_order
      ON order_intents(environment, broker_order_no)
      WHERE broker_order_no IS NOT NULL;
    CREATE INDEX IF NOT EXISTS order_intents_state ON order_intents(state, updated_at);

    CREATE TABLE IF NOT EXISTS position_runtime (
      position_key TEXT PRIMARY KEY,
      environment TEXT NOT NULL,
      market_code TEXT NOT NULL,
      code TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT 0,
      available_quantity INTEGER NOT NULL DEFAULT 0,
      average_price REAL NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT,
      trailing_activated INTEGER NOT NULL DEFAULT 0,
      trailing_peak REAL,
      dead_cross_candle_key TEXT,
      dead_cross_relation REAL,
      last_signal_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engine_health (
      environment TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      last_sync_at TEXT,
      last_event_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_events (
      id TEXT PRIMARY KEY,
      position_key TEXT NOT NULL,
      environment TEXT NOT NULL,
      signals_json TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engine_leases (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return database;
}

export const strategyDatabase = globalDatabase.__strategyRuntimeDatabase ??= createDatabase();

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function orderFromRow(row: Record<string, unknown>): OrderRecord {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    positionKey: String(row.position_key),
    environment: String(row.environment) as MockEnvironment,
    side: String(row.side) as OrderSide,
    source: String(row.source) as SellIntentSource,
    code: String(row.code),
    marketCode: String(row.market_code),
    reasons: parseJsonArray<string>(row.reasons_json),
    orderedQuantity: Number(row.ordered_quantity),
    filledQuantity: Number(row.filled_quantity),
    remainingQuantity: Number(row.remaining_quantity),
    state: String(row.state) as OrderState,
    brokerOrderNo: row.broker_order_no == null ? null : String(row.broker_order_no),
    trId: String(row.tr_id ?? ""),
    message: String(row.message ?? ""),
    needsAttention: Boolean(row.needs_attention),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function positionFromRow(row: Record<string, unknown>): PositionGeneration {
  return {
    positionKey: String(row.position_key),
    environment: String(row.environment) as MockEnvironment,
    marketCode: String(row.market_code),
    code: String(row.code),
    generation: Number(row.generation),
    quantity: Number(row.quantity),
    availableQuantity: Number(row.available_quantity),
    averagePrice: Number(row.average_price),
    paused: Boolean(row.paused),
    pauseReason: row.pause_reason == null ? null : String(row.pause_reason),
    trailingActivated: Boolean(row.trailing_activated),
    trailingPeak: row.trailing_peak == null ? null : Number(row.trailing_peak),
    deadCrossCandleKey: row.dead_cross_candle_key == null ? null : String(row.dead_cross_candle_key),
    deadCrossRelation: row.dead_cross_relation == null ? null : Number(row.dead_cross_relation),
    lastSignal: parseJsonArray<StrategySignal>(row.last_signal_json),
    updatedAt: String(row.updated_at),
  };
}

export function makePositionKey(environment: MockEnvironment, marketCode: string, code: string) {
  const normalizedCode = environment === "mock-domestic" ? normalizeDomesticStockCode(code) : code.trim().toUpperCase();
  const normalizedMarket = environment === "mock-domestic" ? "KRX" : marketCode.trim().toUpperCase();
  return `${environment}:${normalizedMarket}:${normalizedCode}`;
}

export function recoverInterruptedOrders() {
  if (globalDatabase.__strategyRuntimeRecovered) return;
  const timestamp = nowIso();
  strategyDatabase.prepare("UPDATE order_intents SET state = 'rejected', message = ?, updated_at = ? WHERE state = 'prepared'")
    .run("주문 전송 전에 프로세스가 종료되어 안전하게 해제했습니다.", timestamp);
  strategyDatabase.prepare("UPDATE order_intents SET state = 'unknown', needs_attention = 1, message = ?, updated_at = ? WHERE state = 'submitting'")
    .run("주문 전송 도중 프로세스가 종료되어 중복 방지를 위해 확인이 필요합니다.", timestamp);
  globalDatabase.__strategyRuntimeRecovered = true;
}

recoverInterruptedOrders();

export type ReserveOrderInput = {
  requestId: string;
  environment: MockEnvironment;
  side: OrderSide;
  source: SellIntentSource;
  code: string;
  marketCode: string;
  reasons: string[];
  quantity: number;
};

export type ReserveOrderResult =
  | { kind: "created"; order: OrderRecord }
  | { kind: "duplicate"; order: OrderRecord }
  | { kind: "conflict"; order: OrderRecord };

export function findOrderByRequestId(requestId: string) {
  const row = strategyDatabase.prepare("SELECT * FROM order_intents WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
  return row ? orderFromRow(row) : null;
}

export function findOrderByBrokerOrderNo(environment: MockEnvironment, orderNo: string) {
  const row = strategyDatabase.prepare("SELECT * FROM order_intents WHERE environment = ? AND broker_order_no = ?").get(environment, orderNo) as Record<string, unknown> | undefined;
  return row ? orderFromRow(row) : null;
}

export function findActiveSell(positionKey: string) {
  const placeholders = ACTIVE_STATES.map(() => "?").join(",");
  const row = strategyDatabase.prepare(`SELECT * FROM order_intents WHERE position_key = ? AND side = 'sell' AND state IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`)
    .get(positionKey, ...ACTIVE_STATES) as Record<string, unknown> | undefined;
  return row ? orderFromRow(row) : null;
}

export function reserveOrder(input: ReserveOrderInput): ReserveOrderResult {
  strategyDatabase.exec("BEGIN IMMEDIATE");
  try {
    const duplicate = findOrderByRequestId(input.requestId);
    if (duplicate) {
      strategyDatabase.exec("COMMIT");
      return { kind: "duplicate", order: duplicate };
    }
    const positionKey = makePositionKey(input.environment, input.marketCode, input.code);
    if (input.side === "sell") {
      const active = findActiveSell(positionKey);
      if (active) {
        strategyDatabase.exec("COMMIT");
        return { kind: "conflict", order: active };
      }
    }
    const id = randomUUID();
    const timestamp = nowIso();
    strategyDatabase.prepare(`INSERT INTO order_intents
      (id, request_id, position_key, environment, side, source, code, market_code, reasons_json,
       ordered_quantity, filled_quantity, remaining_quantity, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'prepared', ?, ?)`)
      .run(id, input.requestId, positionKey, input.environment, input.side, input.source, input.code, input.marketCode,
        JSON.stringify([...new Set(input.reasons)]), input.quantity, input.quantity, timestamp, timestamp);
    const created = findOrderByRequestId(input.requestId);
    if (!created) throw new Error("주문 의도를 저장하지 못했습니다.");
    strategyDatabase.exec("COMMIT");
    return { kind: "created", order: created };
  } catch (error) {
    strategyDatabase.exec("ROLLBACK");
    if (String(error).includes("order_intents_active_sell_position")) {
      const active = findActiveSell(makePositionKey(input.environment, input.marketCode, input.code));
      if (active) return { kind: "conflict", order: active };
    }
    throw error;
  }
}

export type OrderUpdate = Partial<Pick<OrderRecord, "brokerOrderNo" | "trId" | "message" | "filledQuantity" | "remainingQuantity" | "needsAttention">> & { state?: OrderState };

export function updateOrder(id: string, update: OrderUpdate) {
  const currentRow = strategyDatabase.prepare("SELECT * FROM order_intents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!currentRow) throw new Error("저장된 주문을 찾을 수 없습니다.");
  const current = orderFromRow(currentRow);
  const next = { ...current, ...update, updatedAt: nowIso() };
  strategyDatabase.prepare(`UPDATE order_intents SET broker_order_no = ?, tr_id = ?, message = ?, filled_quantity = ?,
      remaining_quantity = ?, state = ?, needs_attention = ?, updated_at = ? WHERE id = ?`)
    .run(next.brokerOrderNo, next.trId, next.message, next.filledQuantity, next.remainingQuantity, next.state,
      next.needsAttention ? 1 : 0, next.updatedAt, id);
  return findOrderByRequestId(current.requestId)!;
}

export function appendOrderReasons(id: string, reasons: string[]) {
  const row = strategyDatabase.prepare("SELECT * FROM order_intents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("저장된 주문을 찾을 수 없습니다.");
  const order = orderFromRow(row);
  const merged = [...new Set([...order.reasons, ...reasons])];
  strategyDatabase.prepare("UPDATE order_intents SET reasons_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), nowIso(), id);
  return findOrderByRequestId(order.requestId)!;
}

export function listActiveOrders(environment?: MockEnvironment) {
  const placeholders = ACTIVE_STATES.map(() => "?").join(",");
  const rows = environment
    ? strategyDatabase.prepare(`SELECT * FROM order_intents WHERE environment = ? AND state IN (${placeholders}) ORDER BY created_at`).all(environment, ...ACTIVE_STATES)
    : strategyDatabase.prepare(`SELECT * FROM order_intents WHERE state IN (${placeholders}) ORDER BY created_at`).all(...ACTIVE_STATES);
  return (rows as Record<string, unknown>[]).map(orderFromRow);
}

export function importExternalSellOrder(input: Omit<ReserveOrderInput, "requestId" | "side" | "source" | "reasons"> & { orderNo: string; filledQuantity: number; remainingQuantity: number; trId: string }) {
  const existing = findOrderByBrokerOrderNo(input.environment, input.orderNo);
  if (existing) return existing;
  const requestId = `external:${input.environment}:${input.orderNo}`;
  const result = reserveOrder({ ...input, requestId, side: "sell", source: "external", reasons: ["외부에서 접수된 매도 주문"] });
  if (result.kind === "conflict") return result.order;
  return updateOrder(result.order.id, {
    brokerOrderNo: input.orderNo,
    trId: input.trId,
    filledQuantity: input.filledQuantity,
    remainingQuantity: input.remainingQuantity,
    state: input.filledQuantity > 0 ? "partial" : "accepted",
    message: "외부 매도 주문을 감지했습니다.",
  });
}

export function getPosition(positionKey: string) {
  const row = strategyDatabase.prepare("SELECT * FROM position_runtime WHERE position_key = ?").get(positionKey) as Record<string, unknown> | undefined;
  return row ? positionFromRow(row) : null;
}

export function listPositions(environment?: MockEnvironment) {
  const rows = environment
    ? strategyDatabase.prepare("SELECT * FROM position_runtime WHERE environment = ? ORDER BY code").all(environment)
    : strategyDatabase.prepare("SELECT * FROM position_runtime ORDER BY environment, code").all();
  return (rows as Record<string, unknown>[]).map(positionFromRow);
}

export function upsertPosition(input: Omit<PositionGeneration, "positionKey" | "updatedAt">) {
  const positionKey = makePositionKey(input.environment, input.marketCode, input.code);
  const timestamp = nowIso();
  strategyDatabase.prepare(`INSERT INTO position_runtime
    (position_key, environment, market_code, code, generation, quantity, available_quantity, average_price, paused, pause_reason,
     trailing_activated, trailing_peak, dead_cross_candle_key, dead_cross_relation, last_signal_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_key) DO UPDATE SET generation=excluded.generation, quantity=excluded.quantity,
      available_quantity=excluded.available_quantity, average_price=excluded.average_price, paused=excluded.paused,
      pause_reason=excluded.pause_reason, trailing_activated=excluded.trailing_activated, trailing_peak=excluded.trailing_peak,
      dead_cross_candle_key=excluded.dead_cross_candle_key, dead_cross_relation=excluded.dead_cross_relation,
      last_signal_json=excluded.last_signal_json, updated_at=excluded.updated_at`)
    .run(positionKey, input.environment, input.marketCode, input.code, input.generation, input.quantity, input.availableQuantity,
      input.averagePrice, input.paused ? 1 : 0, input.pauseReason, input.trailingActivated ? 1 : 0, input.trailingPeak,
      input.deadCrossCandleKey, input.deadCrossRelation, JSON.stringify(input.lastSignal), timestamp);
  return getPosition(positionKey)!;
}

export function pausePosition(positionKey: string, reason: string) {
  const timestamp = nowIso();
  const updated = strategyDatabase.prepare("UPDATE position_runtime SET paused = 1, pause_reason = ?, updated_at = ? WHERE position_key = ?")
    .run(reason, timestamp, positionKey);
  if (updated.changes === 0) {
    const [environment, marketCode, ...codeParts] = positionKey.split(":");
    strategyDatabase.prepare(`INSERT INTO position_runtime
      (position_key, environment, market_code, code, generation, quantity, available_quantity, average_price, paused, pause_reason,
       trailing_activated, trailing_peak, dead_cross_candle_key, dead_cross_relation, last_signal_json, updated_at)
      VALUES (?, ?, ?, ?, 1, 0, 0, 0, 1, ?, 0, NULL, NULL, NULL, '[]', ?)`)
      .run(positionKey, environment, marketCode, codeParts.join(":"), reason, timestamp);
  }
  return getPosition(positionKey);
}

export function resumePosition(positionKey: string) {
  strategyDatabase.prepare("UPDATE position_runtime SET paused = 0, pause_reason = NULL, updated_at = ? WHERE position_key = ?")
    .run(nowIso(), positionKey);
  return getPosition(positionKey);
}

export function recordStrategyEvent(environment: MockEnvironment, positionKey: string, signals: StrategySignal[], mode: "shadow" | "mock") {
  const timestamp = nowIso();
  strategyDatabase.prepare("INSERT INTO strategy_events (id, position_key, environment, signals_json, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), positionKey, environment, JSON.stringify(signals), mode, timestamp);
  strategyDatabase.prepare("UPDATE position_runtime SET last_signal_json = ?, updated_at = ? WHERE position_key = ?")
    .run(JSON.stringify(signals), timestamp, positionKey);
}

export function setEngineHealth(environment: MockEnvironment, state: EngineState, message: string, options: { synced?: boolean; event?: boolean } = {}) {
  const timestamp = nowIso();
  const current = getEngineHealth(environment);
  const lastSyncAt = options.synced ? timestamp : current?.lastSyncAt ?? null;
  const lastEventAt = options.event ? timestamp : current?.lastEventAt ?? null;
  strategyDatabase.prepare(`INSERT INTO engine_health (environment, state, message, last_sync_at, last_event_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(environment) DO UPDATE SET state=excluded.state, message=excluded.message,
      last_sync_at=excluded.last_sync_at, last_event_at=excluded.last_event_at, updated_at=excluded.updated_at`)
    .run(environment, state, message, lastSyncAt, lastEventAt, timestamp);
  return getEngineHealth(environment)!;
}

export function getEngineHealth(environment: MockEnvironment) {
  const row = strategyDatabase.prepare("SELECT * FROM engine_health WHERE environment = ?").get(environment) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    environment: String(row.environment) as MockEnvironment,
    state: String(row.state) as EngineState,
    message: String(row.message),
    lastSyncAt: row.last_sync_at == null ? null : String(row.last_sync_at),
    lastEventAt: row.last_event_at == null ? null : String(row.last_event_at),
    updatedAt: String(row.updated_at),
  } satisfies EngineHealth;
}

export function listEngineHealth() {
  return (["mock-domestic", "mock-overseas"] as const).map((environment) =>
    getEngineHealth(environment) ?? ({ environment, state: "off", message: "실행되지 않음", lastSyncAt: null, lastEventAt: null, updatedAt: nowIso() } satisfies EngineHealth));
}

export function acquireEngineLease(name: string, owner: string, lifetimeMs: number) {
  const expiresAt = Date.now() + lifetimeMs;
  strategyDatabase.exec("BEGIN IMMEDIATE");
  try {
    const row = strategyDatabase.prepare("SELECT owner, expires_at FROM engine_leases WHERE name = ?").get(name) as { owner?: string; expires_at?: number } | undefined;
    if (row && Number(row.expires_at) > Date.now() && row.owner !== owner) {
      strategyDatabase.exec("COMMIT");
      return false;
    }
    strategyDatabase.prepare(`INSERT INTO engine_leases(name, owner, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at`).run(name, owner, expiresAt);
    strategyDatabase.exec("COMMIT");
    return true;
  } catch (error) {
    strategyDatabase.exec("ROLLBACK");
    throw error;
  }
}

export function releaseEngineLease(name: string, owner: string) {
  strategyDatabase.prepare("DELETE FROM engine_leases WHERE name = ? AND owner = ?").run(name, owner);
}

export function closeStrategyDatabase() {
  strategyDatabase.close();
  delete globalDatabase.__strategyRuntimeDatabase;
  delete globalDatabase.__strategyRuntimeRecovered;
}
