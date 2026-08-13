import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDomesticStockCode } from "../app/api/kiwoom.server.ts";

test("normalizes Kiwoom domestic stock-list suffixes for order APIs", () => {
  assert.equal(normalizeDomesticStockCode("487400_AL"), "487400");
  assert.equal(normalizeDomesticStockCode("005930"), "005930");
  assert.equal(normalizeDomesticStockCode(" aapl "), "AAPL");
});
