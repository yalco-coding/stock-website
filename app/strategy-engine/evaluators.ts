import { MARKET_SCHEDULES, type DeadCrossMarketSettings, type SlTpMarketSettings, type StrategyMarket, type TrailingStopMarketSettings } from "../strategy-settings";
import type { CompletedCandle, PriceSnapshot, StrategySignal } from "./types";

export const MAX_PRICE_AGE_MS = 15_000;

function marketClock(now: Date, market: StrategyMarket) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_SCHEDULES[market].timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: value("weekday"), time: `${value("hour")}:${value("minute")}` };
}

export function isWithinStrategyWindow(now: Date, market: StrategyMarket, startTime: string, endTime: string) {
  const clock = marketClock(now, market);
  return !["Sat", "Sun"].includes(clock.weekday) && clock.time >= startTime && clock.time <= endTime;
}

export function isFreshPrice(snapshot: PriceSnapshot, now = new Date()) {
  return Number.isFinite(snapshot.price) && snapshot.price > 0 &&
    Number.isFinite(new Date(snapshot.observedAt).getTime()) &&
    now.getTime() - new Date(snapshot.observedAt).getTime() >= 0 &&
    now.getTime() - new Date(snapshot.observedAt).getTime() <= MAX_PRICE_AGE_MS;
}

export function percentToBasisPoints(percent: number) {
  return Math.round(percent * 100);
}

export function profitBasisPoints(averagePrice: number, currentPrice: number) {
  if (!(averagePrice > 0) || !(currentPrice > 0)) return Number.NaN;
  return Math.round(((currentPrice - averagePrice) / averagePrice) * 10_000);
}

function signal(strategy: StrategySignal["strategy"], positionKey: string, positionGeneration: number, observedAt: string, reason: string): StrategySignal {
  return { strategy, positionKey, positionGeneration, observedAt, reason };
}

export function evaluateSlTp(input: {
  settings: SlTpMarketSettings;
  averagePrice: number;
  price: PriceSnapshot;
  positionKey: string;
  positionGeneration: number;
}) {
  const basisPoints = profitBasisPoints(input.averagePrice, input.price.price);
  if (!Number.isFinite(basisPoints)) return null;
  const takeProfit = percentToBasisPoints(input.settings.takeProfitPercent);
  const stopLoss = percentToBasisPoints(input.settings.stopLossPercent);
  if (basisPoints >= takeProfit) {
    return signal("slTp", input.positionKey, input.positionGeneration, input.price.observedAt,
      `평균 매입가 대비 수익률 ${(basisPoints / 100).toFixed(2)}%가 익절 기준 ${input.settings.takeProfitPercent.toFixed(2)}%에 도달`);
  }
  if (basisPoints <= -stopLoss) {
    return signal("slTp", input.positionKey, input.positionGeneration, input.price.observedAt,
      `평균 매입가 대비 수익률 ${(basisPoints / 100).toFixed(2)}%가 손절 기준 -${input.settings.stopLossPercent.toFixed(2)}%에 도달`);
  }
  return null;
}

export type TrailingEvaluation = {
  activated: boolean;
  peak: number | null;
  signal: StrategySignal | null;
};

export function evaluateTrailingStop(input: {
  settings: TrailingStopMarketSettings;
  averagePrice: number;
  price: PriceSnapshot;
  positionKey: string;
  positionGeneration: number;
  activated: boolean;
  peak: number | null;
}): TrailingEvaluation {
  const profit = profitBasisPoints(input.averagePrice, input.price.price);
  let activated = input.activated;
  let peak = input.peak;
  if (!activated && profit >= percentToBasisPoints(input.settings.activationProfitPercent)) {
    activated = true;
    peak = input.price.price;
  }
  if (!activated) return { activated: false, peak: null, signal: null };
  peak = Math.max(peak ?? input.price.price, input.price.price);
  const drawdown = Math.round(((peak - input.price.price) / peak) * 10_000);
  const matched = drawdown >= percentToBasisPoints(input.settings.drawdownPercent);
  return {
    activated,
    peak,
    signal: matched
      ? signal("trailingStop", input.positionKey, input.positionGeneration, input.price.observedAt,
          `보존된 고점 ${peak} 대비 ${(drawdown / 100).toFixed(2)}% 하락해 기준 ${input.settings.drawdownPercent.toFixed(2)}%에 도달`)
      : null,
  };
}

function simpleMovingAverage(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type DeadCrossEvaluation = {
  candleKey: string | null;
  relation: number | null;
  signal: StrategySignal | null;
};

export function evaluateDeadCross(input: {
  settings: DeadCrossMarketSettings;
  completedCandles: CompletedCandle[];
  positionKey: string;
  positionGeneration: number;
  previousCandleKey: string | null;
  previousRelation: number | null;
  observedAt: string;
}): DeadCrossEvaluation {
  const candles = input.completedCandles
    .filter((candle) => candle.key && Number.isFinite(candle.close) && candle.close > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
  if (candles.length < input.settings.longPeriod) return { candleKey: input.previousCandleKey, relation: input.previousRelation, signal: null };
  const latest = candles.at(-1)!;
  const closes = candles.map((candle) => candle.close);
  const short = simpleMovingAverage(closes.slice(-input.settings.shortPeriod));
  const long = simpleMovingAverage(closes.slice(-input.settings.longPeriod));
  const relation = short - long;
  if (!input.previousCandleKey || input.previousRelation == null) return { candleKey: latest.key, relation, signal: null };
  if (latest.key <= input.previousCandleKey) return { candleKey: input.previousCandleKey, relation: input.previousRelation, signal: null };
  const crossed = input.previousRelation >= 0 && relation < 0;
  return {
    candleKey: latest.key,
    relation,
    signal: crossed
      ? signal("deadCross", input.positionKey, input.positionGeneration, input.observedAt,
          `완료 봉 ${latest.key}에서 단기 이동평균이 장기 이동평균을 하향 돌파`)
      : null,
  };
}

export function mergeStrategySignals(signals: Array<StrategySignal | null>) {
  const unique = new Map<string, StrategySignal>();
  for (const item of signals) if (item) unique.set(`${item.strategy}:${item.reason}`, item);
  return [...unique.values()];
}

export function isExcludedStock(code: string, marketCode: string, excluded: { code: string; marketCode: string }[]) {
  const normalizedCode = code.trim().toUpperCase().replace(/^[AJQ](?=\d{6}$)/, "");
  return excluded.some((stock) => stock.code.trim().toUpperCase().replace(/^[AJQ](?=\d{6}$)/, "") === normalizedCode &&
    (!stock.marketCode || stock.marketCode.toUpperCase() === marketCode.toUpperCase()));
}
