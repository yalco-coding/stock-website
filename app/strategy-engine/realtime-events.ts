import { normalizeDomesticStockCode, type MockEnvironment } from "../api/kiwoom.server";

export type RealtimeEntry = { type?: string; item?: string; stexTp?: string; values?: Record<string, unknown> };
export type RealtimeMessage = { trnm?: string; return_code?: number | string; return_msg?: string; data?: RealtimeEntry[] };

export function parseRealtimeMessage(raw: unknown): RealtimeMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RealtimeMessage : null;
  } catch {
    return null;
  }
}

export function normalizeRealtimePrice(input: {
  environment: MockEnvironment;
  entry: RealtimeEntry;
  expectedCode: string;
  expectedMarketCode: string;
  localDate: string;
  previousEventKey?: string;
}) {
  const code = input.environment === "mock-domestic"
    ? normalizeDomesticStockCode(String(input.entry.item ?? ""))
    : String(input.entry.item ?? "").trim().toUpperCase();
  if (code !== input.expectedCode || !input.entry.values) return null;
  const parsedPrice = Number(String(input.entry.values["10"] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsedPrice) || parsedPrice === 0) return null;
  const exchange = input.environment === "mock-domestic"
    ? String(input.entry.values["9081"] ?? "KRX")
    : String(input.entry.stexTp ?? "");
  if (exchange && exchange !== input.expectedMarketCode) return null;
  const time = String(input.entry.values["20"] ?? "").replace(/\D/g, "").slice(0, 6);
  const date = input.environment === "mock-overseas"
    ? String(input.entry.values["22"] ?? "").replace(/\D/g, "").slice(0, 8)
    : input.localDate;
  const eventKey = `${date}${time}`;
  if (!/^\d{14}$/.test(eventKey) || eventKey <= (input.previousEventKey ?? "")) return null;
  return { code, price: Math.abs(parsedPrice), eventKey };
}
