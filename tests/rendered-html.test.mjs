import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the Kiwoom Ledger account dashboard", async () => {
  const [page, dashboard, route, quantityControls, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stocks/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/orders/sell/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/StockTradePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/HoldingsTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/OrderQuantityControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]).then(([page, dashboard, route, searchRoute, sellRoute, panel, holdingsTable, quantityControls, packageJson]) => [page, dashboard + panel + holdingsTable, route + searchRoute + sellRoute, quantityControls, packageJson]);
  assert.match(page, /Kiwoom Ledger/);
  assert.match(dashboard, /계좌 현황/);
  assert.match(dashboard, /국내 모의/);
  assert.match(dashboard, /해외 모의/);
  assert.match(dashboard, /국내.*실전/);
  assert.match(dashboard, /해외.*실전/);
  assert.match(dashboard, /실투자 매수·매도 기능은 비활성화/);
  assert.match(dashboard, /종목 검색/);
  assert.match(dashboard, /주문을 확인해 주세요/);
  assert.match(quantityControls, /100_000, 500_000, 1_000_000/);
  assert.match(quantityControls, /환율을 추정하지 않고 입력한 USD 예산/);
  assert.match(dashboard, /매도 가능/);
  assert.match(dashboard, /aria-sort/);
  assert.match(dashboard, /오름차순/);
  assert.match(dashboard, /내림차순/);
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
  assert.match(auth, /x-forwarded-proto/);
  assert.match(login, /secure: isHttpsRequest\(request\)/);
  assert.match(login, /status: 503/);
  assert.match(login, /x-forwarded-host/);
  assert.match(login, /x-forwarded-proto/);
  assert.match(loginForm, /content-type/);
  assert.doesNotMatch(proxy + auth + login, /KRA_(?:REAL|MOCK).*SECRET/);
});

test("stores and manages a browser-local watchlist", async () => {
  const [dashboard, watchlist] = await Promise.all([
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/Watchlist.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(watchlist, /window\.localStorage/);
  assert.match(watchlist, /kiwoom-ledger:watchlist:v1/);
  assert.match(watchlist, /관심종목 추가/);
  assert.match(watchlist, /관심종목 삭제/);
  assert.match(dashboard, /<WatchlistButton/);
  assert.match(dashboard, /<WatchlistView/);
  assert.match(dashboard, />관심종목</);
});
