import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the Kiwoom Ledger account dashboard", async () => {
  const [page, dashboard, route, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stocks/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/orders/sell/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/StockTradePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]).then(([page, dashboard, route, searchRoute, sellRoute, panel, packageJson]) => [page, dashboard + panel, route + searchRoute + sellRoute, packageJson]);
  assert.match(page, /Kiwoom Ledger/);
  assert.match(dashboard, /계좌 현황/);
  assert.match(dashboard, /국내 모의/);
  assert.match(dashboard, /해외 모의/);
  assert.match(dashboard, /국내.*실전/);
  assert.match(dashboard, /해외.*실전/);
  assert.match(dashboard, /실투자 매수·매도 기능은 비활성화/);
  assert.match(dashboard, /종목 검색/);
  assert.match(dashboard, /주문을 확인해 주세요/);
  assert.match(dashboard, /매도 가능/);
  assert.match(route, /kt10001/);
  assert.match(route, /ust20001/);
  assert.match(route, /kt00018/);
  assert.match(route, /ust21070/);
  assert.match(route, /ust21110/);
  assert.match(route, /ka10099/);
  assert.match(route, /usa10099/);
  assert.match(dashboard, /USD 예수금/);
  assert.doesNotMatch(page + dashboard + route, /KRA_(?:REAL|MOCK).*SECRET[^\n]*=/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("protects pages and APIs with a signed, expiring secure session", async () => {
  const [proxy, auth, login, loginForm] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/LoginForm.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /isValidSession/);
  assert.match(proxy, /status: 401/);
  assert.match(auth, /HMAC/);
  assert.match(auth, /kiwoom-ledger:session:v1/);
  assert.match(auth, /SESSION_TTL_SECONDS = 8 \* 60 \* 60/);
  assert.match(login, /MAX_ATTEMPTS = 5/);
  assert.match(login, /httpOnly: true/);
  assert.match(login, /sameSite: "strict"/);
  assert.match(login, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(login, /status: 503/);
  assert.match(loginForm, /content-type/);
  assert.doesNotMatch(proxy + auth + login, /KRA_(?:REAL|MOCK).*SECRET/);
});
