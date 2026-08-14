"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { DEFAULT_STRATEGY_SETTINGS, MARKET_SCHEDULES, type ExcludedStock, type StrategyMarket, type StrategySettings, type TrailingStopMarketSettings } from "../strategy-settings";
import { ExcludedStockEditor, MarketTabs, PercentField, SettingsSection, SettingsToggle, TimeRangeFields } from "./StrategyControls";

type Environment = "real-domestic" | "real-overseas" | "mock-domestic" | "mock-overseas";
type SearchResponse = { results: ExcludedStock[]; message?: string };
type SettingsResponse = { settings: StrategySettings; revision?: number; message?: string };

export function TrailingStopSettings({ environment }: { environment: Environment }) {
  const real = environment.startsWith("real-");
  const enabledMarkets: StrategyMarket[] = real ? ["domestic", "overseas"] : [environment.endsWith("domestic") ? "domestic" : "overseas"];
  const [selectedMarket, setSelectedMarket] = useState<StrategyMarket>(enabledMarkets[0]);
  const [settings, setSettings] = useState<StrategySettings>(DEFAULT_STRATEGY_SETTINGS);
  const [search, setSearch] = useState(""); const [results, setResults] = useState<ExcludedStock[]>([]); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [saveNotice, setSaveNotice] = useState("");
  const changeRevision = useRef(0);
  const serverRevision = useRef(DEFAULT_STRATEGY_SETTINGS.revision);
  const market = enabledMarkets.includes(selectedMarket) ? selectedMarket : enabledMarkets[0];
  const current = settings.strategies.trailingStop[market]; const schedule = MARKET_SCHEDULES[market];

  useEffect(() => {
    fetch("/api/settings/strategies", { cache: "no-store" })
      .then(async (response) => { const body = await response.json() as SettingsResponse; if (!response.ok) throw new Error(body.message); return body; })
      .then((body) => { serverRevision.current = body.revision ?? body.settings.revision; setSettings(body.settings); })
      .catch(() => setSaveNotice("저장된 전략 설정을 불러오지 못해 기본값을 표시합니다."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || changeRevision.current === 0) return;
    const revision = changeRevision.current;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        const response = await fetch("/api/settings/strategies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategy: "trailingStop", market, patch: settings.strategies.trailingStop[market], expectedRevision: serverRevision.current }) });
        const body = await response.json() as SettingsResponse;
        if (response.status === 409 && body.settings) { serverRevision.current = body.revision ?? body.settings.revision; changeRevision.current = 0; setSettings(body.settings); setSaveNotice(body.message || "최신 설정을 다시 불러왔습니다."); return; }
        if (!response.ok) throw new Error(body.message);
        serverRevision.current = body.revision ?? body.settings.revision;
        if (changeRevision.current === revision) { changeRevision.current = 0; setSaveNotice("전략 설정을 자동 저장했습니다."); }
      } catch (error) {
        if (changeRevision.current === revision) setSaveNotice(error instanceof Error ? error.message : "전략 설정을 저장하지 못했습니다.");
      } finally {
        setSaving(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [loading, market, settings]);

  const update = (next: Partial<TrailingStopMarketSettings>) => { if (real) return; changeRevision.current += 1; setSaveNotice(""); setSettings((value) => ({ ...value, strategies: { ...value.strategies, trailingStop: { ...value.strategies.trailingStop, [market]: { ...value.strategies.trailingStop[market], ...next } } } })); };
  async function submitSearch(event: FormEvent) { event.preventDefault(); const value = search.trim(); if (!value) return; setSearching(true); setSearchError(""); try { const searchEnvironment = `${real ? "real" : "mock"}-${market}` as Environment; const response = await fetch(`/api/stocks/search?environment=${searchEnvironment}&q=${encodeURIComponent(value)}`, { cache: "no-store" }); const body = await response.json() as SearchResponse; if (!response.ok) throw new Error(body.message); setResults(body.results); } catch (error) { setSearchError(error instanceof Error ? error.message : "종목을 검색하지 못했습니다."); } finally { setSearching(false); } }
  const add = (stock: ExcludedStock) => { if (!current.excludedStocks.some((item) => item.code === stock.code && item.marketCode === stock.marketCode)) update({ excludedStocks: [...current.excludedStocks, stock] }); setResults([]); setSearch(""); };
  const remove = (stock: ExcludedStock) => update({ excludedStocks: current.excludedStocks.filter((item) => item.code !== stock.code || item.marketCode !== stock.marketCode) });

  return <div className="mx-auto max-w-4xl"><div className="mb-7"><div className="mb-2 text-xs font-semibold text-emerald-800">AUTOMATED STRATEGY</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">트레일링 스탑 자동매도</h1><p className="mt-2 text-sm text-slate-500">수익 활성화 조건과 고점 추적 기준을 설정합니다. 변경한 값은 기존 전략 설정에 함께 자동 저장되며, 현재는 주문이 실행되지 않습니다.</p></div>{(saving || saveNotice) && <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-600" aria-live="polite">{saving ? <LoaderCircle size={16} className="animate-spin text-emerald-700"/> : <CheckCircle2 size={16} className="text-emerald-700"/>}{saving ? "전략 설정 저장 중…" : saveNotice}</p>}{loading ? <div className="grid min-h-64 place-items-center rounded-2xl border border-[#dbe4df] bg-white"><LoaderCircle className="animate-spin text-emerald-800"/></div> : <><MarketTabs value={market} enabledMarkets={enabledMarkets} onChange={(next) => { setSelectedMarket(next); setResults([]); setSearch(""); setSearchError(""); }}/><div className="mt-5 space-y-5"><SettingsSection><div className="flex flex-col gap-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-bold text-slate-900">{market === "domestic" ? "국내" : "미국"} 트레일링 스탑</h2><p className="mt-1 text-xs text-slate-500">{schedule.timeZone} 기준</p></div><SettingsToggle checked={current.enabled} onChange={(enabled) => update({ enabled })}/></div><TimeRangeFields start={current.startTime} end={current.endTime} min={schedule.open} max={schedule.close} timeZone={schedule.timeZone} onChange={({ start, end }) => update({ startTime: start, endTime: end })}/><div className="grid gap-3 sm:grid-cols-2"><PercentField label="활성화 수익률" value={current.activationProfitPercent} description="평균 매입가 대비 수익률을 기준으로 활성화합니다." onChange={(activationProfitPercent) => update({ activationProfitPercent })}/><PercentField label="고점 대비 하락률" value={current.drawdownPercent} description="활성화 이후 기록한 고점 대비 하락 폭입니다." onChange={(drawdownPercent) => update({ drawdownPercent })}/></div><ExcludedStockEditor query={search} onQueryChange={setSearch} onSubmit={submitSearch} searching={searching} results={results} stocks={current.excludedStocks} onAdd={add} onRemove={remove} error={searchError || undefined}/></div></SettingsSection><div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><p>평균 매입가 대비 활성화 수익률에 도달한 뒤 고점을 추적합니다. 고점 대비 설정한 하락률에 도달하면 <strong>매도 가능 수량 전량을 시장가</strong>로 매도할 예정입니다. 현재 화면에서는 설정만 편집하며 자동 주문은 실행하지 않습니다.</p></div></div></>}</div>;
}
