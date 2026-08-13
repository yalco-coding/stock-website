import assert from "node:assert/strict";
import test from "node:test";
import { domesticTickSize, normalizeDomesticOrderPrice } from "../app/domestic-order-price.ts";

test("uses the KRX tick size for domestic shares", () => {
  assert.equal(domesticTickSize(268_750, "KOSPI"), 500);
  assert.equal(normalizeDomesticOrderPrice(268_750, "KOSPI", false, "buy"), 268_500);
  assert.equal(normalizeDomesticOrderPrice(268_750, "KOSPI", false, "sell"), 269_000);
});

test("uses product and KOSDAQ-specific tick sizes", () => {
  assert.equal(domesticTickSize(268_750, "KOSDAQ"), 100);
  assert.equal(domesticTickSize(108_053, "KOSPI", true), 5);
  assert.equal(normalizeDomesticOrderPrice(108_053, "KOSPI", true, "buy"), 108_050);
});
