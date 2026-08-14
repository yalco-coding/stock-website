"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { CANDLE_INTERVALS, DEFAULT_STRATEGY_SETTINGS, MARKET_SCHEDULES, type DeadCrossMarketSettings, type ExcludedStock, type StrategyMarket, type StrategySettings } from "../strategy-settings";
import { ExcludedStockEditor, MarketTabs, SettingsSection, SettingsToggle, TimeRangeFields } from "./StrategyControls";

type Environment = "real-domestic" | "real-overseas" | "mock-domestic" | "mock-overseas";
type SearchResponse = { results: ExcludedStock[]; message?: string };
type SettingsResponse = { settings: StrategySettings; revision?: number; message?: string };

export function DeadCrossSettings({ environment }: { environment: Environment }) {
  const real = environment.startsWith("real-");
  const enabledMarkets: StrategyMarket[] = real ? ["domestic", "overseas"] : [environment.endsWith("domestic") ? "domestic" : "overseas"];
  const [selectedMarket, setSelectedMarket] = useState<StrategyMarket>(enabledMarkets[0]);
  const [settings, setSettings] = useState<StrategySettings>(DEFAULT_STRATEGY_SETTINGS);
  const [search, setSearch] = useState(""); const [results, setResults] = useState<ExcludedStock[]>([]); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [saveNotice, setSaveNotice] = useState("");
  const changeRevision = useRef(0);
  const serverRevision = useRef(DEFAULT_STRATEGY_SETTINGS.revision);
  const market = enabledMarkets.includes(selectedMarket) ? selectedMarket : enabledMarkets[0];
  const current = settings.strategies.deadCross[market]; const schedule = MARKET_SCHEDULES[market]; const intervals = CANDLE_INTERVALS[market];
  const periodError = !Number.isSafeInteger(current.shortPeriod) || current.shortPeriod < 2 || !Number.isSafeInteger(current.longPeriod) || current.longPeriod < 3 ? "이동평균 기간은 2 이상의 정수 봉 개수로 입력해 주세요." : current.shortPeriod >= current.longPeriod ? "단기 이동평균 기간은 장기 이동평균 기간보다 작아야 합니다." : "";

  useEffect(() => {
    fetch("/api/settings/strategies", { cache: "no-store" })
      .then(async (response) => { const body = await response.json() as SettingsResponse; if (!response.ok) throw new Error(body.message); return body; })
      .then((body) => { serverRevision.current = body.revision ?? body.settings.revision; setSettings(body.settings); })
      .catch(() => setSaveNotice("저장된 전략 설정을 불러오지 못해 기본값을 표시합니다."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || changeRevision.current === 0 || periodError) return;
    const revision = changeRevision.current;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        const response = await fetch("/api/settings/strategies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategy: "deadCross", market, patch: settings.strategies.deadCross[market], expectedRevision: serverRevision.current }) });
        const body = await response.json() as SettingsResponse;
        if (response.status === 409 && body.settings) { serverRevision.current = body.revision ?? body.settings.revision; changeRevision.current = 0; setSettings(body.settings); setSaveNotice(body.message || "최신 설정을 다시 불러왔습니다."); return; }
        if (!response.ok) throw new Error(body.message);
        serverRevision.current = body.revision ?? body.settings.revision;
        if (changeRevision.current === revision) { changeRevision.current = 0; setSaveNotice("전략 설정을 자동 저장했습니다."); }
      } catch (error) {
        if (changeRevision.current === revision) setSaveNotice(error instanceof Error ? error.message : "전략 설정을 저장하지 못했습니다.");
      } finally { setSaving(false); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [loading, market, periodError, settings]);

  const update = (next: Partial<DeadCrossMarketSettings>) => { if (real) return; changeRevision.current += 1; setSaveNotice(""); setSettings((value) => ({ ...value, strategies: { ...value.strategies, deadCross: { ...value.strategies.deadCross, [market]: { ...value.strategies.deadCross[market], ...next } } } })); };
  async function submitSearch(event: FormEvent) { event.preventDefault(); const value = search.trim(); if (!value) return; setSearching(true); setSearchError(""); try { const searchEnvironment = `${real ? "real" : "mock"}-${market}` as Environment; const response = await fetch(`/api/stocks/search?environment=${searchEnvironment}&q=${encodeURIComponent(value)}`, { cache: "no-store" }); const body = await response.json() as SearchResponse; if (!response.ok) throw new Error(body.message); setResults(body.results); } catch (error) { setSearchError(error instanceof Error ? error.message : "종목을 검색하지 못했습니다."); } finally { setSearching(false); } }
  const add = (stock: ExcludedStock) => { if (!current.excludedStocks.some((item) => item.code === stock.code && item.marketCode === stock.marketCode)) update({ excludedStocks: [...current.excludedStocks, stock] }); setResults([]); setSearch(""); };
  const remove = (stock: ExcludedStock) => update({ excludedStocks: current.excludedStocks.filter((item) => item.code !== stock.code || item.marketCode !== stock.marketCode) });

  return <div className="mx-auto max-w-4xl"><div className="mb-7"><div className="mb-2 text-xs font-semibold text-emerald-800">AUTOMATED STRATEGY</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">데드크로스 자동매도</h1><p className="mt-2 text-sm text-slate-500">완료된 봉의 종가를 기준으로 단순 이동평균선을 계산합니다. 변경한 값은 기존 전략 설정에 함께 자동 저장되며, 현재는 주문이 실행되지 않습니다.</p></div>{(saving || saveNotice) && <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-600" aria-live="polite">{saving ? <LoaderCircle size={16} className="animate-spin text-emerald-700"/> : <CheckCircle2 size={16} className="text-emerald-700"/>}{saving ? "전략 설정 저장 중…" : saveNotice}</p>}{loading ? <div className="grid min-h-64 place-items-center rounded-2xl border border-[#dbe4df] bg-white"><LoaderCircle className="animate-spin text-emerald-800"/></div> : <><MarketTabs value={market} enabledMarkets={enabledMarkets} onChange={(next) => { setSelectedMarket(next); setResults([]); setSearch(""); setSearchError(""); }}/><div className="mt-5 space-y-5"><SettingsSection><div className="flex flex-col gap-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-bold text-slate-900">{market === "domestic" ? "국내" : "미국"} 데드크로스</h2><p className="mt-1 text-xs text-slate-500">{schedule.timeZone} 기준</p></div><SettingsToggle checked={current.enabled} onChange={(enabled) => update({ enabled })}/></div><TimeRangeFields start={current.startTime} end={current.endTime} min={schedule.open} max={schedule.close} timeZone={schedule.timeZone} onChange={({ start, end }) => update({ startTime: start, endTime: end })}/><label className="text-xs font-bold text-slate-500">봉 주기<select aria-label="봉 주기" value={current.candleInterval} onChange={(event) => update({ candleInterval: event.target.value as DeadCrossMarketSettings["candleInterval"] })} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-emerald-700">{intervals.map((interval) => <option key={interval.value} value={interval.value}>{interval.label} · {interval.apiId}</option>)}</select><span className="mt-1.5 block text-[11px] font-normal text-slate-400">키움 REST API 차트 명세에 명시된 주기만 제공합니다.</span></label><div className="grid gap-3 sm:grid-cols-2"><PeriodField label="단기 이동평균 기간" value={current.shortPeriod} onChange={(shortPeriod) => update({ shortPeriod })}/><PeriodField label="장기 이동평균 기간" value={current.longPeriod} onChange={(longPeriod) => update({ longPeriod })}/></div>{periodError ? <p className="text-xs font-semibold text-rose-600" role="alert">{periodError}</p> : <p className="text-[11px] leading-5 text-slate-400">기간 단위는 완료된 봉의 개수입니다. 차트 API는 연속조회를 지원하지만 최대 조회 봉 수는 명세에 고정되어 있지 않으므로, 실제 데이터가 장기 기간보다 적으면 신호를 계산할 수 없습니다.</p>}<ExcludedStockEditor query={search} onQueryChange={setSearch} onSubmit={submitSearch} searching={searching} results={results} stocks={current.excludedStocks} onAdd={add} onRemove={remove} error={searchError || undefined}/></div></SettingsSection><div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><p>완료된 봉의 종가로 계산한 <strong>단순 이동평균</strong>에서 단기선이 장기선을 하향 돌파하면 <strong>매도 가능 수량 전량을 시장가</strong>로 매도할 예정입니다. 현재 화면에서는 설정만 편집하며 자동 주문은 실행하지 않습니다.</p></div></div></>}</div>;
}

function PeriodField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-xs font-bold text-slate-500">{label} (봉 개수)<input aria-label={`${label} 봉 개수`} type="number" min="2" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-emerald-700"/></label>;
}
