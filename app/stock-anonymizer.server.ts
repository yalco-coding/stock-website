import "server-only";

import { createHash } from "node:crypto";
import fictionalNames from "./data/fictional-stock-names.json";

type NamedStock = {
  code: string;
  marketCode?: string;
  name: string;
  englishName?: string;
};

const namePools = {
  domestic: fictionalNames.domestic,
  overseas: fictionalNames.overseas,
} as const;

export function fictionalStockName(code: string, _marketCode: string | undefined, domestic: boolean) {
  const pool = domestic ? namePools.domestic : namePools.overseas;
  const key = `${domestic ? "KR" : "US"}:${code.trim().toUpperCase()}`;
  const digest = createHash("sha256").update(`stock-lecture-v1:${key}`).digest();
  return pool[digest.readUInt32BE(0) % pool.length];
}

export function anonymizeStock<T extends NamedStock>(stock: T, domestic: boolean): T {
  return {
    ...stock,
    name: fictionalStockName(stock.code, stock.marketCode, domestic),
    englishName: undefined,
  };
}
