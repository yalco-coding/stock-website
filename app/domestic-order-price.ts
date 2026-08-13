export type DomesticMarket = "KOSPI" | "KOSDAQ" | "KONEX";

export function domesticTickSize(price: number, market: string, isEtf = false): number {
  if (isEtf) return 5;
  if (price < 1_000) return 1;
  if (price < 5_000) return 5;
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  if (price < 100_000) return 100;
  if (market === "KOSDAQ" || market === "KONEX") return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function normalizeDomesticOrderPrice(price: number, market: string, isEtf = false, side: "buy" | "sell" = "buy"): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const tick = domesticTickSize(price, market, isEtf);
  return (side === "buy" ? Math.floor(price / tick) : Math.ceil(price / tick)) * tick;
}
