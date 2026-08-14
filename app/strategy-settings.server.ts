import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CANDLE_INTERVALS, DEFAULT_STRATEGY_SETTINGS, MARKET_SCHEDULES, type StrategyMarket, type StrategySettings } from "./strategy-settings";

const settingsPath = process.env.STRATEGY_SETTINGS_PATH || path.join(process.cwd(), ".data", "strategy-settings.json");
const dataDirectory = path.dirname(settingsPath);
type StrategyName = keyof StrategySettings["strategies"];
type SettingsGlobal = typeof globalThis & { __strategySettingsWriteQueue?: Promise<void> };
const settingsGlobal = globalThis as SettingsGlobal;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidExcludedStock(stock: unknown) {
  if (!isRecord(stock)) return false;
  return typeof stock.code === "string" && typeof stock.name === "string" && typeof stock.market === "string" && typeof stock.marketCode === "string";
}

export function isValidStrategySettings(value: unknown): value is StrategySettings {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<StrategySettings>;
  if (candidate.version !== 2 || !Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0 ||
      !candidate.strategies?.slTp || !candidate.strategies?.trailingStop || !candidate.strategies?.deadCross) return false;
  return (["domestic", "overseas"] as const).every((market) => {
    const settings = candidate.strategies!.slTp[market];
    const trailingStop = candidate.strategies!.trailingStop[market];
    const deadCross = candidate.strategies!.deadCross[market];
    const schedule = MARKET_SCHEDULES[market];
    return !!settings && typeof settings.enabled === "boolean" &&
      typeof settings.startTime === "string" && settings.startTime >= schedule.open && settings.startTime <= schedule.close &&
      typeof settings.endTime === "string" && settings.endTime >= schedule.open && settings.endTime <= schedule.close && settings.startTime < settings.endTime &&
      Number.isFinite(settings.takeProfitPercent) && settings.takeProfitPercent > 0 &&
      Number.isFinite(settings.stopLossPercent) && settings.stopLossPercent > 0 && Array.isArray(settings.excludedStocks) &&
      settings.excludedStocks.every(isValidExcludedStock) && !!trailingStop && typeof trailingStop.enabled === "boolean" &&
      typeof trailingStop.startTime === "string" && trailingStop.startTime >= schedule.open && trailingStop.startTime <= schedule.close &&
      typeof trailingStop.endTime === "string" && trailingStop.endTime >= schedule.open && trailingStop.endTime <= schedule.close && trailingStop.startTime < trailingStop.endTime &&
      Number.isFinite(trailingStop.activationProfitPercent) && trailingStop.activationProfitPercent > 0 &&
      Number.isFinite(trailingStop.drawdownPercent) && trailingStop.drawdownPercent > 0 && Array.isArray(trailingStop.excludedStocks) &&
      trailingStop.excludedStocks.every(isValidExcludedStock) && !!deadCross && typeof deadCross.enabled === "boolean" &&
      typeof deadCross.startTime === "string" && deadCross.startTime >= schedule.open && deadCross.startTime <= schedule.close &&
      typeof deadCross.endTime === "string" && deadCross.endTime >= schedule.open && deadCross.endTime <= schedule.close && deadCross.startTime < deadCross.endTime &&
      CANDLE_INTERVALS[market].some((interval) => interval.value === deadCross.candleInterval) &&
      Number.isSafeInteger(deadCross.shortPeriod) && deadCross.shortPeriod >= 2 && Number.isSafeInteger(deadCross.longPeriod) && deadCross.longPeriod > deadCross.shortPeriod &&
      Array.isArray(deadCross.excludedStocks) && deadCross.excludedStocks.every(isValidExcludedStock);
  });
}

function migrateSettings(stored: unknown): StrategySettings | null {
  if (!isRecord(stored) || !isRecord(stored.strategies)) return null;
  const strategies = stored.strategies as Record<string, unknown>;
  const migrated = structuredClone(DEFAULT_STRATEGY_SETTINGS);
  for (const strategy of ["slTp", "trailingStop", "deadCross"] as const) {
    if (!isRecord(strategies[strategy])) continue;
    for (const market of ["domestic", "overseas"] as const) {
      const legacyMarket = (strategies[strategy] as Record<string, unknown>)[market];
      if (isRecord(legacyMarket)) Object.assign(migrated.strategies[strategy][market], legacyMarket);
    }
  }
  migrated.revision = Number.isSafeInteger(stored.revision) ? Number(stored.revision) : 0;
  return isValidStrategySettings(migrated) ? migrated : null;
}

async function readStoredSettings(): Promise<{ settings: StrategySettings; migrated: boolean }> {
  try {
    const stored: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ settingsPath, "utf8"));
    if (isValidStrategySettings(stored)) return { settings: stored, migrated: false };
    const migrated = migrateSettings(stored);
    if (migrated) return { settings: migrated, migrated: true };
    console.error("전략 설정 파일의 형식이 올바르지 않아 기본값을 사용합니다.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("전략 설정 파일을 읽지 못했습니다.", error);
  }
  return { settings: structuredClone(DEFAULT_STRATEGY_SETTINGS), migrated: false };
}

export async function getStrategySettings(): Promise<StrategySettings> {
  const result = await readStoredSettings();
  if (result.migrated) {
    return withSettingsWriteLock(async () => {
      const latest = await readStoredSettings();
      if (latest.migrated) await saveStrategySettings(latest.settings);
      return latest.settings;
    });
  }
  return result.settings;
}

async function saveStrategySettings(settings: StrategySettings): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, settingsPath);
}

async function withSettingsWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  let failure: unknown;
  const previous = settingsGlobal.__strategySettingsWriteQueue ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    try { result = await operation(); }
    catch (error) { failure = error; }
  });
  settingsGlobal.__strategySettingsWriteQueue = current;
  await current;
  if (failure) throw failure;
  return result;
}

export class StrategySettingsRevisionConflict extends Error {
  readonly settings: StrategySettings;

  constructor(settings: StrategySettings) {
    super("다른 화면에서 설정이 먼저 변경되었습니다. 최신 설정을 다시 불러왔습니다.");
    this.settings = settings;
  }
}

export type StrategySettingsPatch = {
  strategy: StrategyName;
  market: StrategyMarket;
  patch: Record<string, unknown>;
  expectedRevision: number;
};

export type StrategySettingsReplacement = {
  settings: StrategySettings;
  expectedRevision: number;
};

export function isValidStrategySettingsPatch(value: unknown): value is StrategySettingsPatch {
  if (!isRecord(value) || !isRecord(value.patch)) return false;
  return ["slTp", "trailingStop", "deadCross"].includes(String(value.strategy)) &&
    ["domestic", "overseas"].includes(String(value.market)) &&
    Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0;
}

export function isValidStrategySettingsReplacement(value: unknown): value is StrategySettingsReplacement {
  return isRecord(value) && isValidStrategySettings(value.settings) &&
    Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0;
}

export async function patchStrategySettings(input: StrategySettingsPatch) {
  return withSettingsWriteLock(async () => {
    const settings = (await readStoredSettings()).settings;
    if (settings.revision !== input.expectedRevision) throw new StrategySettingsRevisionConflict(settings);
    const currentMarket = settings.strategies[input.strategy][input.market] as unknown as Record<string, unknown>;
    if (Object.keys(input.patch).some((key) => !Object.hasOwn(currentMarket, key))) throw new Error("지원하지 않는 설정 항목이 포함되어 있습니다.");
    const next = structuredClone(settings);
    Object.assign(next.strategies[input.strategy][input.market], input.patch);
    next.revision += 1;
    if (!isValidStrategySettings(next)) throw new Error("전략 설정값을 확인해 주세요.");
    await saveStrategySettings(next);
    return next;
  });
}

export async function replaceStrategySettings(input: StrategySettingsReplacement) {
  return withSettingsWriteLock(async () => {
    const current = (await readStoredSettings()).settings;
    if (current.revision !== input.expectedRevision) throw new StrategySettingsRevisionConflict(current);
    const next = structuredClone(input.settings);
    next.revision = current.revision + 1;
    if (!isValidStrategySettings(next)) throw new Error("가져올 전략 설정값을 확인해 주세요.");
    await saveStrategySettings(next);
    return next;
  });
}
