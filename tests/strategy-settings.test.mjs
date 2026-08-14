import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CANDLE_INTERVALS, DEFAULT_STRATEGY_SETTINGS, MARKET_SCHEDULES } from "../app/strategy-settings.ts";

test("SL / TP defaults use each market's regular session and share one strategy settings structure", () => {
  assert.deepEqual(MARKET_SCHEDULES.domestic, { timeZone: "Asia/Seoul", open: "09:00", close: "15:30" });
  assert.deepEqual(MARKET_SCHEDULES.overseas, { timeZone: "America/New_York", open: "09:30", close: "16:00" });
  assert.equal(DEFAULT_STRATEGY_SETTINGS.version, 2);
  assert.equal(DEFAULT_STRATEGY_SETTINGS.revision, 0);
  assert.ok(DEFAULT_STRATEGY_SETTINGS.strategies.slTp.domestic);
  assert.ok(DEFAULT_STRATEGY_SETTINGS.strategies.slTp.overseas);
  assert.deepEqual(DEFAULT_STRATEGY_SETTINGS.strategies.trailingStop.domestic, { enabled: false, startTime: "09:00", endTime: "15:30", activationProfitPercent: 5, drawdownPercent: 2, excludedStocks: [] });
  assert.deepEqual(DEFAULT_STRATEGY_SETTINGS.strategies.trailingStop.overseas, { enabled: false, startTime: "09:30", endTime: "16:00", activationProfitPercent: 5, drawdownPercent: 2, excludedStocks: [] });
  assert.ok(DEFAULT_STRATEGY_SETTINGS.strategies.deadCross.domestic.shortPeriod < DEFAULT_STRATEGY_SETTINGS.strategies.deadCross.domestic.longPeriod);
  assert.deepEqual(CANDLE_INTERVALS.domestic.map(({ value }) => value), ["minute:1", "minute:3", "minute:5", "minute:10", "minute:15", "minute:30", "minute:45", "minute:60", "day", "week", "month"]);
  assert.deepEqual(CANDLE_INTERVALS.overseas.map(({ value }) => value), ["minute:1", "day", "week", "month", "year", "quarter"]);
});

test("version 1 settings migrate to version 2 and stale revisions are rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strategy-settings-"));
  const settingsPath = path.join(directory, "settings.json");
  const legacy = structuredClone(DEFAULT_STRATEGY_SETTINGS);
  legacy.version = 1;
  delete legacy.revision;
  await writeFile(settingsPath, JSON.stringify(legacy), "utf8");
  process.env.STRATEGY_SETTINGS_PATH = settingsPath;
  const server = await import(`../app/strategy-settings.server.ts?test=${Date.now()}`);
  try {
    const migrated = await server.getStrategySettings();
    assert.equal(migrated.version, 2);
    assert.equal(migrated.revision, 0);
    assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).version, 2);
    const updated = await server.patchStrategySettings({ strategy: "slTp", market: "domestic", patch: { takeProfitPercent: 7 }, expectedRevision: 0 });
    assert.equal(updated.revision, 1);
    assert.equal(updated.strategies.slTp.domestic.takeProfitPercent, 7);
    await assert.rejects(
      server.patchStrategySettings({ strategy: "trailingStop", market: "domestic", patch: { drawdownPercent: 3 }, expectedRevision: 0 }),
      (error) => error instanceof server.StrategySettingsRevisionConflict && error.settings.revision === 1,
    );
  } finally {
    delete process.env.STRATEGY_SETTINGS_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});

test("full strategy settings can be copied to another server without reusing the source revision", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strategy-settings-import-"));
  const settingsPath = path.join(directory, "settings.json");
  const current = structuredClone(DEFAULT_STRATEGY_SETTINGS);
  current.revision = 8;
  await writeFile(settingsPath, JSON.stringify(current), "utf8");
  process.env.STRATEGY_SETTINGS_PATH = settingsPath;
  const server = await import(`../app/strategy-settings.server.ts?import-test=${Date.now()}`);
  try {
    const copied = structuredClone(DEFAULT_STRATEGY_SETTINGS);
    copied.revision = 42;
    copied.strategies.slTp.domestic.enabled = true;
    copied.strategies.slTp.domestic.takeProfitPercent = 9;
    const imported = await server.replaceStrategySettings({ settings: copied, expectedRevision: 8 });
    assert.equal(imported.revision, 9);
    assert.equal(imported.strategies.slTp.domestic.enabled, true);
    assert.equal(imported.strategies.slTp.domestic.takeProfitPercent, 9);
    assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).revision, 9);
    await assert.rejects(
      server.replaceStrategySettings({ settings: copied, expectedRevision: 8 }),
      (error) => error instanceof server.StrategySettingsRevisionConflict && error.settings.revision === 9,
    );
  } finally {
    delete process.env.STRATEGY_SETTINGS_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});

test("strategy settings transfer UI copies and pastes the complete JSON through the shared endpoint", async () => {
  const [dashboard, transfer, route, server] = await Promise.all([
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/StrategySettingsTransfer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/strategies/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/strategy-settings.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />전략 설정 옮기기</);
  assert.match(dashboard, /<StrategySettingsTransfer/);
  assert.match(transfer, /전체 전략 설정 JSON/);
  assert.match(transfer, /navigator\.clipboard/);
  assert.match(transfer, /method: "PUT"/);
  assert.match(transfer, /window\.confirm/);
  assert.match(transfer, /인증정보와 텔레그램 설정은 포함되지 않습니다/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /isValidStrategySettingsReplacement/);
  assert.match(server, /replaceStrategySettings/);
});

test("dead cross UI uses documented chart intervals and shared strategy controls", async () => {
  const [dashboard, deadCross, server] = await Promise.all([
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/DeadCrossSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/strategy-settings.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />데드크로스</);
  assert.match(dashboard, /<DeadCrossSettings environment=/);
  for (const control of ["MarketTabs", "SettingsToggle", "TimeRangeFields", "ExcludedStockEditor"]) assert.match(deadCross, new RegExp(control));
  for (const apiId of ["ka10080", "ka10081", "ka10082", "ka10083", "usa06011", "usa06012", "usa06013", "usa06014", "usa06015", "usa06016"]) assert.match(JSON.stringify(CANDLE_INTERVALS), new RegExp(apiId));
  assert.match(deadCross, /완료된 봉의 종가/);
  assert.match(deadCross, /단순 이동평균/);
  assert.match(deadCross, /단기 이동평균 기간은 장기 이동평균 기간보다 작아야/);
  assert.match(deadCross, /매도 가능 수량 전량을 시장가/);
  assert.match(deadCross, /\/api\/settings\/strategies/);
  assert.match(deadCross, /\/api\/stocks\/search/);
  assert.match(server, /deadCross/);
});

test("trailing stop UI reuses strategy controls and persists in the shared strategy settings JSON", async () => {
  const [dashboard, trailingStop, controls, server] = await Promise.all([
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/TrailingStopSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/StrategyControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/strategy-settings.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />트레일링 스탑</);
  assert.match(dashboard, /<TrailingStopSettings environment=/);
  assert.match(trailingStop, /MarketTabs/);
  assert.match(trailingStop, /SettingsToggle/);
  assert.match(trailingStop, /TimeRangeFields/);
  assert.match(trailingStop, /ExcludedStockEditor/);
  assert.match(trailingStop, /PercentField/);
  assert.match(controls, /export function PercentField/);
  assert.match(trailingStop, /활성화 수익률/);
  assert.match(trailingStop, /평균 매입가 대비/);
  assert.match(trailingStop, /고점 대비 하락률/);
  assert.match(trailingStop, /매도 가능 수량 전량을 시장가/);
  assert.match(trailingStop, /\/api\/settings\/strategies/);
  assert.match(trailingStop, /\/api\/stocks\/search/);
  assert.match(server, /trailingStop/);
});

test("SL / TP UI persists settings and reuses controls and the existing stock search endpoint", async () => {
  const [dashboard, settings, controls, route, server] = await Promise.all([
    readFile(new URL("../app/ui/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/SlTpSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/StrategyControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/strategies/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/strategy-settings.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />SL \/ TP</);
  assert.match(settings, /\/api\/stocks\/search/);
  assert.match(settings, /매도 가능 수량 전량을 시장가/);
  assert.doesNotMatch(settings, /전체 전략 설정 가져오기|전체 전략 설정 JSON|navigator\.clipboard/);
  assert.match(settings, /자동 저장/);
  assert.match(settings, /setTimeout/);
  assert.doesNotMatch(settings, />설정 저장</);
  assert.match(settings, /\/api\/settings\/strategies/);
  assert.match(route, /patchStrategySettings/);
  assert.match(route, /expectedRevision|isValidStrategySettingsPatch/);
  assert.match(server, /strategy-settings\.json/);
  assert.match(server, /rename\(temporaryPath, settingsPath\)/);
  assert.match(controls, /export function MarketTabs/);
  assert.match(controls, /export function SettingsToggle/);
  assert.match(controls, /export function TimeRangeFields/);
  assert.match(controls, /export function ExcludedStockEditor/);
});
