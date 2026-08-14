import type { MockEnvironment } from "../api/kiwoom.server";

export type StrategyKind = "slTp" | "trailingStop" | "deadCross";
export type OrderSide = "buy" | "sell";
export type SellIntentSource = "manual" | "strategy" | "external";
export type OrderState =
  | "prepared"
  | "submitting"
  | "accepted"
  | "partial"
  | "filled"
  | "unknown"
  | "rejected"
  | "cancelled-partial"
  | "manual-review";

export type StrategySignal = {
  strategy: StrategyKind;
  positionKey: string;
  positionGeneration: number;
  observedAt: string;
  reason: string;
};

export type PriceSnapshot = {
  price: number;
  observedAt: string;
};

export type CompletedCandle = {
  key: string;
  close: number;
};

export type OrderRecord = {
  id: string;
  requestId: string;
  positionKey: string;
  environment: MockEnvironment;
  side: OrderSide;
  source: SellIntentSource;
  code: string;
  marketCode: string;
  reasons: string[];
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  state: OrderState;
  brokerOrderNo: string | null;
  trId: string;
  message: string;
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PositionGeneration = {
  positionKey: string;
  environment: MockEnvironment;
  marketCode: string;
  code: string;
  generation: number;
  quantity: number;
  availableQuantity: number;
  averagePrice: number;
  paused: boolean;
  pauseReason: string | null;
  trailingActivated: boolean;
  trailingPeak: number | null;
  deadCrossCandleKey: string | null;
  deadCrossRelation: number | null;
  lastSignal: StrategySignal[];
  updatedAt: string;
};

export type EngineState = "off" | "starting" | "synchronizing" | "ready" | "paused" | "stopped";
export type EngineHealth = {
  environment: MockEnvironment;
  state: EngineState;
  message: string;
  lastSyncAt: string | null;
  lastEventAt: string | null;
  updatedAt: string;
};

export type BrokerOrderSnapshot = {
  orderNo: string;
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  state: Extract<OrderState, "accepted" | "partial" | "filled" | "rejected" | "cancelled-partial" | "manual-review">;
  message: string;
};
