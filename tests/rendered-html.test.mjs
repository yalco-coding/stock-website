import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the Kiwoom Ledger account dashboard", async () => {
  const [page, dashboard, route, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stocks/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]).then(([page, dashboard, route, searchRoute, packageJson]) => [page, dashboard, route + searchRoute, packageJson]);
  assert.match(page, /Kiwoom Ledger/);
  assert.match(dashboard, /계좌 현황/);
  assert.match(dashboard, /국내 모의/);
  assert.match(dashboard, /해외 모의/);
  assert.match(dashboard, /종목 검색/);
  assert.match(route, /kt00018/);
  assert.match(route, /ust21070/);
  assert.match(route, /ust21110/);
  assert.match(route, /ka10099/);
  assert.match(route, /usa10099/);
  assert.match(dashboard, /USD 예수금/);
  assert.doesNotMatch(page + dashboard + route, /KRA_(?:REAL|MOCK).*SECRET[^\n]*=/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
