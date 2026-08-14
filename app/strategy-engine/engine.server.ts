import { randomUUID } from "node:crypto";
import { getMockAccessToken, hasCredentials, invalidateAccessToken, normalizeDomesticStockCode, type MockEnvironment } from "../api/kiwoom.server";
import { getStrategySettings } from "../strategy-settings.server";
import type { StrategyMarket, StrategySettings } from "../strategy-settings";
import { completedChartBars, fetchBrokerPositions, fetchChartBars, KiwoomQueryError, type BrokerPosition } from "./kiwoom-market.server";
import { fetchUnfilledSells } from "./kiwoom-orders.server";
import { evaluateDeadCross, evaluateSlTp, evaluateTrailingStop, isExcludedStock, isFreshPrice, isWithinStrategyWindow, mergeStrategySignals } from "./evaluators";
import { ActiveSellConflictError, reconcileOrder, submitStrategySignals } from "./order-coordinator.server";
import {
  acquireEngineLease,
  closeStrategyDatabase,
  findActiveSell,
  findOrderByBrokerOrderNo,
  getPosition,
  importExternalSellOrder,
  listActiveOrders,
  listEngineHealth,
  listPositions,
  makePositionKey,
  recordStrategyEvent,
  releaseEngineLease,
  resumePosition,
  setEngineHealth,
  updateOrder,
  upsertPosition,
} from "./store.server";
import type { PositionGeneration, PriceSnapshot } from "./types";
import { normalizeRealtimePrice, parseRealtimeMessage, type RealtimeEntry, type RealtimeMessage } from "./realtime-events";

const MAX_SUBSCRIPTIONS = 200;
const MAX_BUFFERED_EVENTS = 5_000;
const REST_SYNC_INTERVAL_MS = 15_000;
const DEAD_CROSS_INTERVAL_MS = 60_000;
const LEASE_LIFETIME_MS = 30_000;
const WS_DOMAIN = "wss://mockapi.kiwoom.com:10000";

function num(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function localDateTimeKey(date: Date, environment: MockEnvironment) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: environment === "mock-domestic" ? "Asia/Seoul" : "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}${part("hour")}${part("minute")}${part("second")}`;
}

class RealtimeSession {
  private socket: WebSocket | null = null;
  private stopped = false;
  private terminal = false;
  private phase: "connecting" | "login" | "synchronizing" | "registration" | "ready" = "connecting";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffered: { message: RealtimeMessage; receivedAt: string }[] = [];
  private subscribed = new Map<string, string>();
  private lastPriceKey = new Map<string, string>();
  private pendingPrices = new Map<string, { entry: RealtimeEntry; observedAt: string }>();
  private priceDrainScheduled = false;
  private accountEvents: RealtimeEntry[] = [];
  private accountDrainScheduled = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHealthWrite = 0;

  constructor(private readonly engine: StrategyEngine, readonly environment: MockEnvironment) {}

  async start() {
    this.stopped = false;
    this.terminal = false;
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    this.engine.markRealtimeReady(this.environment, false);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.reconnectTimer = null;
    this.syncTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ trnm: "REMOVE", grp_no: "1", data: [] })); } catch { /* 연결 종료 중 */ }
      socket.close(1000, "strategy engine shutdown");
    }
  }

  private async connect() {
    if (this.stopped || this.terminal) return;
    this.phase = "connecting";
    setEngineHealth(this.environment, "starting", "웹소켓 연결 중");
    let token: string;
    try {
      token = await getMockAccessToken(this.environment);
    } catch (error) {
      this.fail(error);
      return;
    }
    const path = this.environment === "mock-domestic" ? "/api/dostk/websocket" : "/api/us/websocket";
    const socket = new WebSocket(`${WS_DOMAIN}${path}`);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.stopped) return;
      this.phase = "login";
      socket.send(JSON.stringify({ trnm: "LOGIN", token }));
    });
    socket.addEventListener("message", (event) => void this.onMessage(event.data));
    socket.addEventListener("error", () => {
      if (this.socket === socket) socket.close();
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.engine.markRealtimeReady(this.environment, false);
      this.pendingPrices.clear();
      if (!this.stopped && !this.terminal) {
        setEngineHealth(this.environment, "paused", "웹소켓 연결이 끊겨 주문 판단을 중지했습니다.");
        this.scheduleReconnect();
      }
    });
  }

  private async onMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    const message = parseRealtimeMessage(raw);
    if (!message) { this.halt("손상된 웹소켓 메시지를 받아 환경을 중지했습니다."); return; }
    if (message.trnm === "PING") {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(raw);
      return;
    }
    if (message.trnm === "LOGIN") {
      if (Number(message.return_code ?? 0) !== 0) { this.handleProtocolError(message); return; }
      await this.beginSynchronization();
      return;
    }
    if (message.trnm === "REG") {
      if (Number(message.return_code ?? 0) !== 0) { this.handleProtocolError(message); return; }
      if (this.phase === "registration") await this.finishSynchronization();
      return;
    }
    if (message.trnm !== "REAL") return;
    if (this.phase !== "ready") {
      if (this.buffered.length >= MAX_BUFFERED_EVENTS) { this.halt("웹소켓 이벤트 버퍼가 넘쳐 전체 재동기화가 필요합니다."); return; }
      this.buffered.push({ message, receivedAt: new Date().toISOString() });
      return;
    }
    this.processRealtime(message);
  }

  private async beginSynchronization() {
    this.phase = "synchronizing";
    setEngineHealth(this.environment, "synchronizing", "초기 잔고를 확인하는 중입니다.");
    try {
      await this.engine.synchronize(this.environment, true);
      const count = listPositions(this.environment).filter((position) => position.quantity > 0).length;
      if (count > MAX_SUBSCRIPTIONS) { this.halt(`보유 종목 ${count}개가 웹소켓 한도 ${MAX_SUBSCRIPTIONS}개를 초과했습니다.`); return; }
      this.phase = "registration";
      const sent = this.sendSubscriptionRefresh(true);
      if (!sent) await this.finishSynchronization();
    } catch (error) {
      this.fail(error);
    }
  }

  private async finishSynchronization() {
    try {
      await this.engine.synchronize(this.environment, true);
      await this.engine.primeDeadCross(this.environment);
      this.phase = "ready";
      this.engine.markRealtimeReady(this.environment, true);
      this.reconnectAttempt = 0;
      const buffered = this.buffered.splice(0);
      for (const event of buffered) this.processRealtime(event.message, event.receivedAt);
      setEngineHealth(this.environment, "ready", buffered.length ? `재동기화 후 버퍼 이벤트 ${buffered.length}개를 반영했습니다.` : "실시간 가격을 기다리는 중입니다.", { synced: true });
      this.schedulePeriodicSync();
    } catch (error) {
      this.fail(error);
    }
  }

  private registrationData(positions: PositionGeneration[], types: string[]) {
    if (this.environment === "mock-domestic") return [{ item: positions.map((position) => position.code), type: types }];
    return [{ item: positions.map((position) => ({ jmcode: position.code, stex_tp: position.marketCode })), type: types }];
  }

  private sendSubscriptionRefresh(initial: boolean) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const positions = listPositions(this.environment).filter((position) => position.quantity > 0);
    if (positions.length > MAX_SUBSCRIPTIONS) { this.halt(`보유 종목 ${positions.length}개가 웹소켓 한도 ${MAX_SUBSCRIPTIONS}개를 초과했습니다.`); return false; }
    const current = new Map(positions.map((position) => [position.positionKey, position.marketCode]));
    const removed = [...this.subscribed.keys()].filter((key) => !current.has(key)).map((key) => getPosition(key)).filter(Boolean) as PositionGeneration[];
    if (removed.length > 0) {
      this.socket.send(JSON.stringify({ trnm: "REMOVE", grp_no: "1", data: this.registrationData(removed, this.environment === "mock-domestic" ? ["0B"] : ["FE", "F4", "F5"]) }));
    }
    const registration = this.environment === "mock-domestic"
      ? [
          { item: [""], type: ["00", "04"] },
          ...this.registrationData(positions, ["0B"]),
        ]
      : this.registrationData(positions, ["FE", "F4", "F5"]);
    this.subscribed = current;
    if (registration.length === 0 || (this.environment === "mock-overseas" && positions.length === 0)) return false;
    this.socket.send(JSON.stringify({ trnm: "REG", grp_no: "1", refresh: "1", data: registration }));
    return initial;
  }

  private processRealtime(message: RealtimeMessage, receivedAt = new Date().toISOString()) {
    if (Date.now() - this.lastHealthWrite >= 1_000) {
      this.lastHealthWrite = Date.now();
      setEngineHealth(this.environment, "ready", "실시간 연결 정상", { event: true });
    }
    for (const entry of message.data ?? []) {
      if (entry.type === "0B" || entry.type === "FE") this.queuePrice(entry, receivedAt);
      else if (["00", "04", "F4", "F5"].includes(entry.type ?? "")) this.queueAccountEvent(entry);
    }
  }

  private queuePrice(entry: RealtimeEntry, observedAt: string) {
    const code = this.environment === "mock-domestic"
      ? normalizeDomesticStockCode(String(entry.item ?? ""))
      : String(entry.item ?? "").toUpperCase();
    if (!code || !entry.values) return;
    const position = listPositions(this.environment).find((candidate) => candidate.code === code && candidate.quantity > 0);
    if (!position) return;
    const normalized = normalizeRealtimePrice({ environment: this.environment, entry, expectedCode: position.code, expectedMarketCode: position.marketCode, localDate: localDateTimeKey(new Date(), this.environment).slice(0, 8), previousEventKey: this.lastPriceKey.get(position.positionKey) });
    if (!normalized) return;
    this.lastPriceKey.set(position.positionKey, normalized.eventKey);
    this.pendingPrices.set(position.positionKey, { entry, observedAt });
    if (this.pendingPrices.size > MAX_SUBSCRIPTIONS) { this.halt("가격 이벤트 처리량이 한도를 넘어 환경을 중지했습니다."); return; }
    if (!this.priceDrainScheduled) {
      this.priceDrainScheduled = true;
      queueMicrotask(() => void this.drainPrices());
    }
  }

  private async drainPrices() {
    this.priceDrainScheduled = false;
    if (this.phase !== "ready") { this.pendingPrices.clear(); return; }
    const prices = [...this.pendingPrices.entries()];
    this.pendingPrices.clear();
    for (const [positionKey, value] of prices) {
      const price = Math.abs(num(value.entry.values?.["10"]));
      await this.engine.evaluatePrice(positionKey, { price, observedAt: value.observedAt });
    }
  }

  private queueAccountEvent(entry: RealtimeEntry) {
    if (this.accountEvents.length >= MAX_BUFFERED_EVENTS) { this.halt("주문·체결·잔고 이벤트 큐가 넘쳐 환경을 중지했습니다."); return; }
    this.accountEvents.push(entry);
    if (!this.accountDrainScheduled) {
      this.accountDrainScheduled = true;
      queueMicrotask(() => void this.drainAccountEvents());
    }
  }

  private async drainAccountEvents() {
    this.accountDrainScheduled = false;
    const events = this.accountEvents.splice(0);
    let requiresFullSync = false;
    for (const entry of events) {
      const orderNo = String(entry.values?.["9203"] ?? "").trim();
      const stored = orderNo ? findOrderByBrokerOrderNo(this.environment, orderNo) : null;
      if (stored) {
        try { await reconcileOrder(stored); }
        catch { requiresFullSync = true; }
      } else {
        requiresFullSync = true;
      }
      if (entry.type === "04" || entry.type === "F5") requiresFullSync = true;
    }
    if (requiresFullSync && this.phase === "ready") {
      try {
        await this.engine.synchronize(this.environment, false);
        this.sendSubscriptionRefresh(false);
      } catch (error) {
        this.fail(error);
      }
    }
    if (this.accountEvents.length > 0 && !this.accountDrainScheduled) {
      this.accountDrainScheduled = true;
      queueMicrotask(() => void this.drainAccountEvents());
    }
  }

  private scheduleSynchronization() {
    if (this.syncTimer || this.phase !== "ready") return;
    this.syncTimer = setTimeout(async () => {
      this.syncTimer = null;
      try {
        await this.engine.synchronize(this.environment, false);
        this.sendSubscriptionRefresh(false);
      } catch (error) {
        this.fail(error);
      }
    }, 300);
    this.syncTimer.unref?.();
  }

  private schedulePeriodicSync() {
    if (this.syncTimer || this.stopped || this.phase !== "ready") return;
    this.syncTimer = setTimeout(async () => {
      this.syncTimer = null;
      try {
        await this.engine.synchronize(this.environment, false);
        this.sendSubscriptionRefresh(false);
        this.schedulePeriodicSync();
      } catch (error) {
        this.fail(error);
      }
    }, REST_SYNC_INTERVAL_MS);
    this.syncTimer.unref?.();
  }

  private handleProtocolError(message: RealtimeMessage) {
    const code = Number(message.return_code ?? -1);
    if (code === 8005) {
      invalidateAccessToken(this.environment);
      this.socket?.close();
      return;
    }
    if ([8010, 8030, 8031, 8104].includes(code)) {
      this.halt(`키움 오류 ${code}: ${message.return_msg || "환경을 확인해 주세요."}`);
      return;
    }
    this.fail(new Error(`웹소켓 요청 거절 ${code}: ${message.return_msg || "알 수 없는 오류"}`));
  }

  private fail(error: unknown) {
    if (error instanceof KiwoomQueryError && error.fatal) { this.halt(`키움 오류 ${error.code}: ${error.message}`); return; }
    setEngineHealth(this.environment, "paused", error instanceof Error ? error.message : "연결 오류");
    this.socket?.close();
    if (!this.socket) this.scheduleReconnect();
  }

  private halt(message: string) {
    this.terminal = true;
    this.engine.markRealtimeReady(this.environment, false);
    this.phase = "connecting";
    setEngineHealth(this.environment, "stopped", message);
    this.socket?.close(1008, "safe stop");
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped || this.terminal) return;
    const base = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    const delay = base + Math.floor(Math.random() * Math.max(250, base / 3));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}

export class StrategyEngine {
  readonly mode = "mock" as const;
  private readonly owner = `${process.pid}:${randomUUID()}`;
  private readonly sessions = new Map<MockEnvironment, RealtimeSession>();
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private deadCrossTimer: ReturnType<typeof setInterval> | null = null;
  private settingsCache: { value: StrategySettings; expiresAt: number } | null = null;
  private readonly syncLocks = new Map<MockEnvironment, Promise<void>>();
  private readonly latestPrices = new Map<string, PriceSnapshot>();
  private readonly readyEnvironments = new Set<MockEnvironment>();
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    if (!acquireEngineLease("strategy-engine", this.owner, LEASE_LIFETIME_MS)) {
      for (const environment of ["mock-domestic", "mock-overseas"] as const) setEngineHealth(environment, "stopped", "다른 프로세스가 전략 실행기를 사용 중입니다.");
      return;
    }
    this.leaseTimer = setInterval(() => {
      if (!acquireEngineLease("strategy-engine", this.owner, LEASE_LIFETIME_MS)) void this.stop(false);
    }, LEASE_LIFETIME_MS / 3);
    this.leaseTimer.unref?.();
    for (const environment of ["mock-domestic", "mock-overseas"] as const) {
      if (!hasCredentials(environment)) {
        setEngineHealth(environment, "stopped", "이 모의투자 환경의 인증정보가 없어 실행하지 않았습니다.");
        continue;
      }
      const session = new RealtimeSession(this, environment);
      this.sessions.set(environment, session);
      void session.start();
    }
    this.deadCrossTimer = setInterval(() => void this.evaluateAllDeadCross(), DEAD_CROSS_INTERVAL_MS);
    this.deadCrossTimer.unref?.();
  }

  async stop(closeDatabase = true) {
    if (!this.started) return;
    this.started = false;
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    if (this.deadCrossTimer) clearInterval(this.deadCrossTimer);
    this.leaseTimer = null;
    this.deadCrossTimer = null;
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    this.sessions.clear();
    this.readyEnvironments.clear();
    await Promise.allSettled([...this.syncLocks.values()]);
    releaseEngineLease("strategy-engine", this.owner);
    if (closeDatabase) closeStrategyDatabase();
  }

  private async settings() {
    if (this.settingsCache && this.settingsCache.expiresAt > Date.now()) return this.settingsCache.value;
    const value = await getStrategySettings();
    this.settingsCache = { value, expiresAt: Date.now() + 1_000 };
    return value;
  }

  markRealtimeReady(environment: MockEnvironment, ready: boolean) {
    if (ready) this.readyEnvironments.add(environment);
    else this.readyEnvironments.delete(environment);
  }

  async synchronize(environment: MockEnvironment, restoreTrailing: boolean) {
    const previous = this.syncLocks.get(environment) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.performSynchronization(environment, restoreTrailing));
    this.syncLocks.set(environment, current);
    try { await current; }
    finally { if (this.syncLocks.get(environment) === current) this.syncLocks.delete(environment); }
  }

  private async performSynchronization(environment: MockEnvironment, restoreTrailing: boolean) {
    const unfilled = await fetchUnfilledSells(environment);
    for (const order of unfilled) {
      if (!findOrderByBrokerOrderNo(environment, order.orderNo)) {
        importExternalSellOrder({ environment, code: order.code, marketCode: order.marketCode || (environment === "mock-domestic" ? "KRX" : ""), quantity: order.orderedQuantity, orderNo: order.orderNo, filledQuantity: order.filledQuantity, remainingQuantity: order.remainingQuantity, trId: order.trId });
      }
    }
    for (const order of listActiveOrders(environment)) {
      try { await reconcileOrder(order); }
      catch { /* 잠금을 유지하고 다음 REST 동기화에서 다시 확인 */ }
    }
    const brokerPositions = await fetchBrokerPositions(environment);
    const seen = new Set<string>();
    for (const broker of brokerPositions) {
      const key = makePositionKey(environment, broker.marketCode, broker.code);
      seen.add(key);
      await this.reconcilePosition(broker, restoreTrailing);
    }
    for (const existing of listPositions(environment)) {
      if (existing.quantity > 0 && !seen.has(existing.positionKey)) {
        upsertPosition({ ...existing, quantity: 0, availableQuantity: 0, paused: true, pauseReason: "보유수량이 0이거나 원장에서 종목이 사라졌습니다." });
      }
    }
    setEngineHealth(environment, "synchronizing", "잔고와 주문 원장을 맞췄습니다.", { synced: true });
  }

  private async reconcilePosition(broker: BrokerPosition, restoreTrailing: boolean) {
    const key = makePositionKey(broker.environment, broker.marketCode, broker.code);
    const existing = getPosition(key);
    if (!existing) {
      upsertPosition({ environment: broker.environment, marketCode: broker.marketCode, code: broker.code, generation: 1, quantity: broker.quantity, availableQuantity: broker.availableQuantity, averagePrice: broker.averagePrice, paused: false, pauseReason: null, trailingActivated: false, trailingPeak: null, deadCrossCandleKey: null, deadCrossRelation: null, lastSignal: [] });
      return;
    }
    let next = { ...existing, quantity: broker.quantity, availableQuantity: broker.availableQuantity, averagePrice: broker.averagePrice };
    const averageChanged = existing.averagePrice > 0 && Math.abs(existing.averagePrice - broker.averagePrice) / existing.averagePrice > 0.000001;
    const oldCost = existing.quantity * existing.averagePrice;
    const newCost = broker.quantity * broker.averagePrice;
    const corporateActionSuspected = existing.quantity > 0 && broker.quantity !== existing.quantity && averageChanged && oldCost > 0 && Math.abs(newCost - oldCost) / oldCost < 0.02;
    if (corporateActionSuspected) {
      next = { ...next, paused: true, pauseReason: "수량과 평균 매입가가 반대로 급변해 액면분할·병합 등 기업행사 확인이 필요합니다." };
    } else if (broker.quantity > existing.quantity) {
      next = { ...next, generation: existing.generation + 1, paused: existing.paused, pauseReason: existing.pauseReason, trailingActivated: false, trailingPeak: null, deadCrossCandleKey: null, deadCrossRelation: null, lastSignal: [] };
    } else if (broker.quantity < existing.quantity && !findActiveSell(key)) {
      next = { ...next, paused: true, pauseReason: "설명할 수 없는 보유수량 감소를 감지했습니다." };
    } else if (averageChanged && broker.quantity === existing.quantity) {
      next = { ...next, paused: true, pauseReason: "수량 변화 없이 평균 매입가가 바뀌어 기업행사 또는 외부 변경 확인이 필요합니다." };
    }
    if (restoreTrailing && next.trailingActivated && next.trailingPeak && new Date(existing.updatedAt).getTime() < Date.now() - 15_000) {
      try {
        const bars = await fetchChartBars({ environment: broker.environment, code: broker.code, marketCode: broker.marketCode, interval: "minute:1", minimumCount: 2_000 });
        const since = localDateTimeKey(new Date(existing.updatedAt), broker.environment).slice(0, 12);
        const missed = bars.filter((bar) => bar.key.slice(0, 12) >= since);
        if (missed.length === 0) next = { ...next, paused: true, pauseReason: "트레일링 스탑 누락 구간의 고점을 복원할 수 없습니다." };
        else next.trailingPeak = Math.max(next.trailingPeak, ...missed.map((bar) => bar.high));
      } catch {
        next = { ...next, paused: true, pauseReason: "트레일링 스탑 고점 복원 조회가 실패했습니다." };
      }
    }
    upsertPosition(next);
  }

  async evaluatePrice(positionKey: string, price: PriceSnapshot) {
    if (!this.started) return;
    const position = getPosition(positionKey);
    if (!position || position.paused || position.quantity <= 0 || position.availableQuantity <= 0 || !isFreshPrice(price)) return;
    this.latestPrices.set(positionKey, price);
    const signals = await this.collectPriceSignals(position, price);
    if (signals.length > 0) await this.handleSignals(position, signals);
  }

  private async collectPriceSignals(position: PositionGeneration, price: PriceSnapshot) {
    const market: StrategyMarket = position.environment === "mock-domestic" ? "domestic" : "overseas";
    const settings = await this.settings();
    const slTp = settings.strategies.slTp[market];
    const trailing = settings.strategies.trailingStop[market];
    const now = new Date(price.observedAt);
    const slTpSignal = slTp.enabled && isWithinStrategyWindow(now, market, slTp.startTime, slTp.endTime) && !isExcludedStock(position.code, position.marketCode, slTp.excludedStocks)
      ? evaluateSlTp({ settings: slTp, averagePrice: position.averagePrice, price, positionKey: position.positionKey, positionGeneration: position.generation })
      : null;
    let trailingSignal = null;
    if (trailing.enabled && isWithinStrategyWindow(now, market, trailing.startTime, trailing.endTime) && !isExcludedStock(position.code, position.marketCode, trailing.excludedStocks)) {
      const result = evaluateTrailingStop({ settings: trailing, averagePrice: position.averagePrice, price, positionKey: position.positionKey, positionGeneration: position.generation, activated: position.trailingActivated, peak: position.trailingPeak });
      trailingSignal = result.signal;
      if (result.activated !== position.trailingActivated || result.peak !== position.trailingPeak) {
        const latest = getPosition(position.positionKey) ?? position;
        upsertPosition({ ...latest, trailingActivated: result.activated, trailingPeak: result.peak });
      }
    }
    return mergeStrategySignals([slTpSignal, trailingSignal]);
  }

  async primeDeadCross(environment: MockEnvironment) {
    if (!this.started) return;
    for (const position of listPositions(environment).filter((item) => item.quantity > 0 && !item.paused)) await this.evaluateDeadCrossPosition(position, true);
  }

  private async evaluateAllDeadCross() {
    for (const health of listEngineHealth().filter((item) => item.state === "ready")) {
      for (const position of listPositions(health.environment).filter((item) => item.quantity > 0 && !item.paused)) {
        try { await this.evaluateDeadCrossPosition(position, false); }
        catch { /* 차트 장애에서는 주문하지 않고 다음 완료 봉을 기다림 */ }
      }
    }
  }

  private async evaluateDeadCrossPosition(position: PositionGeneration, primeOnly: boolean) {
    const market: StrategyMarket = position.environment === "mock-domestic" ? "domestic" : "overseas";
    const settings = (await this.settings()).strategies.deadCross[market];
    if (!settings.enabled || isExcludedStock(position.code, position.marketCode, settings.excludedStocks)) return;
    if (!primeOnly && !isWithinStrategyWindow(new Date(), market, settings.startTime, settings.endTime)) return;
    const bars = await fetchChartBars({ environment: position.environment, code: position.code, marketCode: position.marketCode, interval: settings.candleInterval, minimumCount: settings.longPeriod + 2 });
    const completed = completedChartBars(bars, settings.candleInterval, position.environment);
    const evaluated = evaluateDeadCross({
      settings,
      completedCandles: completed,
      positionKey: position.positionKey,
      positionGeneration: position.generation,
      previousCandleKey: primeOnly ? null : position.deadCrossCandleKey,
      previousRelation: primeOnly ? null : position.deadCrossRelation,
      observedAt: new Date().toISOString(),
    });
    const latestPosition = getPosition(position.positionKey) ?? position;
    upsertPosition({ ...latestPosition, deadCrossCandleKey: evaluated.candleKey, deadCrossRelation: evaluated.relation });
    if (evaluated.signal && position.availableQuantity > 0) {
      const latestPrice = this.latestPrices.get(position.positionKey);
      const priceSignals = latestPrice && isFreshPrice(latestPrice) ? await this.collectPriceSignals(latestPosition, latestPrice) : [];
      await this.handleSignals(position, mergeStrategySignals([evaluated.signal, ...priceSignals]));
    }
  }

  private async handleSignals(position: PositionGeneration, signals: NonNullable<ReturnType<typeof mergeStrategySignals>>) {
    recordStrategyEvent(position.environment, position.positionKey, signals, "mock");
    try {
      await submitStrategySignals({ environment: position.environment, code: position.code, marketCode: position.marketCode, quantity: position.availableQuantity, signals, canSubmit: () => this.started && this.readyEnvironments.has(position.environment) });
    } catch (error) {
      if (!(error instanceof ActiveSellConflictError)) console.error(`자동매도 ${position.code} 주문을 안전 중지했습니다.`, error);
    }
  }
}

type EngineGlobal = typeof globalThis & { __strategyEngine?: StrategyEngine; __strategyEngineSignalsInstalled?: boolean };
const engineGlobal = globalThis as EngineGlobal;
export const strategyEngine = engineGlobal.__strategyEngine ??= new StrategyEngine();

export async function startStrategyEngine() {
  await strategyEngine.start();
  if (!engineGlobal.__strategyEngineSignalsInstalled) {
    engineGlobal.__strategyEngineSignalsInstalled = true;
    const shutdown = () => { void strategyEngine.stop().finally(() => process.exit(0)); };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }
}

export function getStrategyEngineStatus() {
  return { mode: strategyEngine.mode, environments: listEngineHealth(), positions: listPositions(), activeOrders: listActiveOrders() };
}

export async function safelyResumePosition(input: { environment: MockEnvironment; code: string; marketCode: string }) {
  const key = makePositionKey(input.environment, input.marketCode, input.code);
  const stored = getPosition(key);
  if (!stored) throw new Error("재개할 보유 종목을 찾을 수 없습니다.");
  const external = await fetchUnfilledSells(input.environment, input.code, input.marketCode);
  if (external.length > 0) throw new Error("키움에 미체결 매도 주문이 있어 재개할 수 없습니다.");
  const active = findActiveSell(key);
  if (active) {
    try { await reconcileOrder(active); }
    catch { /* 아래에서 안전 상태를 다시 판정 */ }
    const stillActive = findActiveSell(key);
    if (stillActive && ["unknown", "manual-review"].includes(stillActive.state) && !stillActive.brokerOrderNo) {
      updateOrder(stillActive.id, { state: "rejected", message: "사용자가 키움 미체결 내역과 잔고를 재확인한 뒤 잠금을 해제했습니다.", needsAttention: false });
    } else if (stillActive) {
      throw new Error("진행 중이거나 주문번호가 확인된 매도 주문이 있어 재개할 수 없습니다.");
    }
  }
  const broker = (await fetchBrokerPositions(input.environment)).find((position) => makePositionKey(position.environment, position.marketCode, position.code) === key);
  if (!broker || broker.quantity <= 0) throw new Error("현재 보유수량을 확인할 수 없어 재개하지 않았습니다.");
  upsertPosition({ ...stored, generation: stored.generation + 1, quantity: broker.quantity, availableQuantity: broker.availableQuantity, averagePrice: broker.averagePrice, paused: false, pauseReason: null, trailingActivated: false, trailingPeak: null, deadCrossCandleKey: null, deadCrossRelation: null, lastSignal: [] });
  return resumePosition(key)!;
}
