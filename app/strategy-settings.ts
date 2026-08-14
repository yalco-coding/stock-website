export type StrategyMarket = "domestic" | "overseas";

export type ExcludedStock = {
  code: string;
  name: string;
  market: string;
  marketCode: string;
};

export type SlTpMarketSettings = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  takeProfitPercent: number;
  stopLossPercent: number;
  excludedStocks: ExcludedStock[];
};

export type TrailingStopMarketSettings = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  activationProfitPercent: number;
  drawdownPercent: number;
  excludedStocks: ExcludedStock[];
};

export type CandleInterval = "minute:1" | "minute:3" | "minute:5" | "minute:10" | "minute:15" | "minute:30" | "minute:45" | "minute:60" | "day" | "week" | "month" | "year" | "quarter";

export type DeadCrossMarketSettings = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  candleInterval: CandleInterval;
  shortPeriod: number;
  longPeriod: number;
  excludedStocks: ExcludedStock[];
};

export type StrategySettings = {
  version: 2;
  revision: number;
  strategies: {
    slTp: Record<StrategyMarket, SlTpMarketSettings>;
    trailingStop: Record<StrategyMarket, TrailingStopMarketSettings>;
    deadCross: Record<StrategyMarket, DeadCrossMarketSettings>;
  };
};

export const MARKET_SCHEDULES = {
  domestic: { timeZone: "Asia/Seoul", open: "09:00", close: "15:30" },
  overseas: { timeZone: "America/New_York", open: "09:30", close: "16:00" },
} as const;

export const CANDLE_INTERVALS: Record<StrategyMarket, readonly { value: CandleInterval; label: string; apiId: string }[]> = {
  domestic: [
    ...([1, 3, 5, 10, 15, 30, 45, 60] as const).map((minutes) => ({ value: `minute:${minutes}` as CandleInterval, label: `${minutes}분봉`, apiId: "ka10080" })),
    { value: "day", label: "일봉", apiId: "ka10081" }, { value: "week", label: "주봉", apiId: "ka10082" }, { value: "month", label: "월봉", apiId: "ka10083" },
  ],
  overseas: [
    { value: "minute:1", label: "1분봉", apiId: "usa06011" }, { value: "day", label: "일봉", apiId: "usa06012" }, { value: "week", label: "주봉", apiId: "usa06013" }, { value: "month", label: "월봉", apiId: "usa06014" }, { value: "year", label: "년봉", apiId: "usa06015" }, { value: "quarter", label: "분기봉", apiId: "usa06016" },
  ],
};

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  version: 2,
  revision: 0,
  strategies: {
    slTp: {
      domestic: { enabled: false, startTime: "09:00", endTime: "15:30", takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
      overseas: { enabled: false, startTime: "09:30", endTime: "16:00", takeProfitPercent: 5, stopLossPercent: 3, excludedStocks: [] },
    },
    trailingStop: {
      domestic: { enabled: false, startTime: "09:00", endTime: "15:30", activationProfitPercent: 5, drawdownPercent: 2, excludedStocks: [] },
      overseas: { enabled: false, startTime: "09:30", endTime: "16:00", activationProfitPercent: 5, drawdownPercent: 2, excludedStocks: [] },
    },
    deadCross: {
      domestic: { enabled: false, startTime: "09:00", endTime: "15:30", candleInterval: "minute:5", shortPeriod: 5, longPeriod: 20, excludedStocks: [] },
      overseas: { enabled: false, startTime: "09:30", endTime: "16:00", candleInterval: "minute:1", shortPeriod: 5, longPeriod: 20, excludedStocks: [] },
    },
  },
};
