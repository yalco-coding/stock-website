"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BarChart3, BriefcaseBusiness, Building2, ChevronRight, CircleDollarSign, Clock3, Flame, Globe2, Landmark, Menu, RefreshCw, Search, ShieldCheck, TrendingUp, Trophy, WalletCards, X } from "lucide-react";
import { QueryProvider } from "./QueryProvider";
import { StockTradePanel, type TradableStock } from "./StockTradePanel";
import { RecentStockSearches } from "./RecentStockSearches";

type Environment = "real-domestic" | "real-overseas" | "mock-domestic" | "mock-overseas";
type Position = { code: string; name: string; market?: string; marketCode: string; quantity: number; availableQuantity: number; averagePrice: number; currentPrice: number; purchaseAmount: number; evaluationAmount: number; profitLoss: number; returnRate: number };
type AccountData = { environment: Environment; currency: "KRW" | "USD"; trId: string; totalPurchase: number; totalEvaluation: number; totalProfitLoss: number; totalReturnRate: number; estimatedAssets?: number; cash?: { krwDeposit: number; usdDeposit: number; usdWithdrawable: number; usdOrderable: number }; positions: Position[]; fetchedAt: string };
type Stock = TradableStock;
type SearchData = { category: "domestic" | "overseas"; trId: string; query: string; results: Stock[] };
type RankingKind = "trading-value" | "gainers" | "volume" | "popular";
type RankingItem = Stock & { rank: number; currentPrice: number; changeRate: number; value: number };
type RankingsData = { environment: Environment; currency: "KRW" | "USD"; rankings: Record<RankingKind, { trId: string; items: RankingItem[] }>; fetchedAt: string };

const money = (value: number, currency: "KRW" | "USD") => new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(value);
const number = (value: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number) => value > 0 ? "text-rose-600" : value < 0 ? "text-blue-600" : "text-slate-500";
const isDomestic = (environment: Environment) => environment.endsWith("domestic");
const isReal = (environment: Environment) => environment.startsWith("real-");
const environmentLabel = (environment: Environment) => `${isDomestic(environment) ? "국내" : "해외"} ${isReal(environment) ? "실투자" : "모의투자"}`;

function isUsRegularMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return !["Sat", "Sun"].includes(weekday) && minutes >= 570 && minutes < 960;
}

async function fetchAccount(environment: Environment): Promise<AccountData> {
  const response = await fetch(`/api/account?environment=${environment}`, { cache: "no-store" });
  const body = await response.json() as AccountData & { message?: string };
  if (!response.ok) throw new Error(body.message || "계좌 정보를 불러오지 못했습니다.");
  return body;
}

async function fetchStocks(environment: Environment, search: string): Promise<SearchData> {
  const response = await fetch(`/api/stocks/search?environment=${environment}&q=${encodeURIComponent(search)}`, { cache: "no-store" });
  const body = await response.json() as SearchData & { message?: string };
  if (!response.ok) throw new Error(body.message || "종목을 검색하지 못했습니다.");
  return body;
}

async function fetchRankings(environment: Environment): Promise<RankingsData> {
  const response = await fetch(`/api/stocks/rankings?environment=${environment}`, { cache: "no-store" });
  const body = await response.json() as RankingsData & { message?: string };
  if (!response.ok) throw new Error(body.message || "순위를 불러오지 못했습니다.");
  return body;
}

function DashboardContent() {
  const [environment, setEnvironment] = useState<Environment>(() => isUsRegularMarketOpen() ? "mock-overseas" : "mock-domestic");
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"account" | "search" | "rankings">("account");
  const [selectedTrade, setSelectedTrade] = useState<{ stock: Stock; mode: "buy" | "sell"; holding?: { quantity: number; availableQuantity: number } } | null>(null);
  const query = useQuery({ queryKey: ["account", environment], queryFn: () => fetchAccount(environment), enabled: view === "account" });
  const label = environmentLabel(environment);

  return <main className="min-h-screen soft-grid">
    <header className="sticky top-0 z-30 border-b border-[#d8e1dc] bg-[#f7f9f7]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center gap-4 px-4 py-3 md:px-7">
        <button className="rounded-lg p-2 text-slate-600 md:hidden" onClick={() => setMenuOpen(true)} aria-label="메뉴 열기"><Menu size={21}/></button>
        <div className="mr-auto flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#173f31] text-white"><Landmark size={19}/></div><div><p className="text-[10px] font-semibold tracking-[.18em] text-emerald-800">KIWOOM LEDGER</p><p className="text-sm font-bold text-slate-800">투자 계좌 대시보드</p></div></div>
        <div className="flex rounded-xl border border-[#d8e1dc] bg-white p-1 shadow-sm" aria-label="투자 환경 선택">
          {(["real-domestic", "real-overseas", "mock-domestic", "mock-overseas"] as const).map((env) => <button key={env} onClick={() => { setEnvironment(env); setSelectedTrade(null); }} className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition ${environment === env ? "bg-[#173f31] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}>{isDomestic(env) ? "국내" : "해외"} {isReal(env) ? "실전" : "모의"}</button>)}
        </div>
      </div>
    </header>
    <div className="mx-auto flex max-w-[1800px]">
      <aside className={`${menuOpen ? "fixed inset-y-0 left-0 z-50 flex w-72" : "hidden"} flex-col border-r border-[#d8e1dc] bg-[#f7f9f7] p-5 md:sticky md:top-[65px] md:flex md:h-[calc(100vh-65px)] md:w-64`}>
        <div className="mb-7 flex items-center justify-between md:hidden"><span className="font-bold">메뉴</span><button onClick={() => setMenuOpen(false)} aria-label="메뉴 닫기"><X/></button></div>
        <p className="mb-2 px-3 text-[10px] font-bold tracking-[.16em] text-slate-400">ACCOUNT</p>
        <button onClick={() => { setView("account"); setMenuOpen(false); }} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold ${view === "account" ? "bg-[#e2ece6] text-[#173f31]" : "text-slate-600 hover:bg-slate-100"}`}><WalletCards size={18}/><span className="flex-1">계좌 확인</span>{view === "account" && <ChevronRight size={16}/>}</button>
        <button onClick={() => { setView("search"); setMenuOpen(false); }} className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold ${view === "search" ? "bg-[#e2ece6] text-[#173f31]" : "text-slate-600 hover:bg-slate-100"}`}><Search size={18}/><span className="flex-1">종목 검색</span>{view === "search" && <ChevronRight size={16}/>}</button>
        <button onClick={() => { setView("rankings"); setMenuOpen(false); }} className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold ${view === "rankings" ? "bg-[#e2ece6] text-[#173f31]" : "text-slate-600 hover:bg-slate-100"}`}><Trophy size={18}/><span className="flex-1">순위</span>{view === "rankings" && <ChevronRight size={16}/>}</button>
        <div className="mt-auto rounded-xl border border-[#d8e1dc] bg-white p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-emerald-800"><ShieldCheck size={16}/>보안 연결</div><p className="text-[11px] leading-5 text-slate-500">인증정보와 접근 토큰은 서버에서만 처리됩니다.</p></div>
      </aside>
      {menuOpen && <button className="fixed inset-0 z-40 bg-black/25 md:hidden" onClick={() => setMenuOpen(false)} aria-label="메뉴 닫기"/>}
      <section className="min-w-0 flex-1 p-4 md:p-8 lg:p-10">
        {view === "search" ? <StockSearch key={environment} environment={environment} onSelect={(stock) => setSelectedTrade({ stock, mode: "buy" })}/> : view === "rankings" ? <RankingView environment={environment} onSelect={(stock) => setSelectedTrade({ stock, mode: "buy" })}/> : <>
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500"/>{label}</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">계좌 현황</h1><p className="mt-2 text-sm text-slate-500">보유 자산의 평가 현황과 수익을 확인하세요.</p></div><button onClick={() => query.refetch()} disabled={query.isFetching} className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#cad5cf] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={query.isFetching ? "animate-spin" : ""}/>{query.isFetching ? "새로고침 중" : "새로고침"}</button></div>
        {query.isLoading && <Loading/>}
        {query.isError && <ErrorState message={query.error.message} retry={() => query.refetch()}/>} 
        {query.data && (
          <AccountView
            data={query.data}
            fetching={query.isFetching}
            onSell={isReal(environment) ? undefined : (position) => setSelectedTrade({
              stock: {
                code: position.code,
                name: position.name,
                market: position.market ?? (isDomestic(environment) ? "KRX" : "미국"),
                marketCode: position.marketCode,
              },
              mode: "sell",
              holding: {
                quantity: position.quantity,
                availableQuantity: position.availableQuantity,
              },
            })}
          />
        )}
        </>}
      </section>
    </div>
    <StockTradePanel key={`${environment}-${selectedTrade?.mode ?? "closed"}-${selectedTrade?.stock.code ?? ""}`} stock={selectedTrade?.stock ?? null} environment={environment} mode={selectedTrade?.mode} holding={selectedTrade?.holding} onClose={() => setSelectedTrade(null)}/>
  </main>;
}

function RankingView({ environment, onSelect }: { environment: Environment; onSelect: (stock: Stock) => void }) {
  const query = useQuery({ queryKey: ["rankings", environment], queryFn: () => fetchRankings(environment), refetchInterval: 60_000 });
  const domestic = isDomestic(environment);
  const sections: { kind: RankingKind; label: string; icon: typeof Trophy }[] = [
    { kind: "trading-value", label: "거래대금 상위", icon: CircleDollarSign },
    { kind: "gainers", label: "상승률 상위", icon: TrendingUp },
    { kind: "volume", label: "거래량 상위", icon: BarChart3 },
    { kind: "popular", label: "인기검색 순위", icon: Flame },
  ];
  const compact = (value: number) => new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);

  return <div>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500"/>{environmentLabel(environment)}</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">종목 순위</h1><p className="mt-2 text-sm text-slate-500">주요 시장 순위를 확인하고 종목 상세 정보를 볼 수 있습니다.</p></div><button onClick={() => query.refetch()} disabled={query.isFetching} className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#cad5cf] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={query.isFetching ? "animate-spin" : ""}/>새로고침</button></div>
      <div className="mb-5 grid max-w-xs grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label="순위 시장 선택">
        <button disabled={!domestic} className={`rounded-lg py-2 text-xs font-bold ${domestic ? "bg-white text-[#173f31] shadow-sm" : "cursor-not-allowed text-slate-300"}`}><Building2 className="mr-1 inline" size={14}/>국내</button>
        <button disabled={domestic} className={`rounded-lg py-2 text-xs font-bold ${!domestic ? "bg-white text-[#173f31] shadow-sm" : "cursor-not-allowed text-slate-300"}`}><Globe2 className="mr-1 inline" size={14}/>해외</button>
      </div>
      {query.isLoading && <div className="grid gap-5 lg:grid-cols-2">{sections.map(({ kind }) => <div key={kind} className="h-72 animate-pulse rounded-2xl bg-white"/>)}</div>}
      {query.isError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p>{query.error.message}</p><button onClick={() => query.refetch()} className="mt-3 font-bold underline">다시 시도</button></div>}
      {query.data && <div className="grid gap-5 lg:grid-cols-2">{sections.map(({ kind, label: sectionLabel, icon: Icon }) => <section key={kind} className="overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_6px_18px_rgba(26,55,43,.04)]"><header className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2"><Icon size={17} className="text-emerald-800"/><h3 className="font-bold text-slate-800">{sectionLabel}</h3></div><span className="text-[10px] text-slate-300">{query.data.rankings[kind].trId}</span></header><ol>{query.data.rankings[kind].items.map((item) => <li key={`${kind}-${item.marketCode}-${item.code}`}><button onClick={() => onSelect(item)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50 focus:bg-slate-50"><span className={`tabular w-6 text-center text-sm font-black ${item.rank <= 3 ? "text-emerald-700" : "text-slate-400"}`}>{item.rank}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{item.name}</p><p className="mt-1 truncate text-[11px] text-slate-400">{item.code} · {item.market}</p></div><div className="text-right">{kind === "gainers" ? <p className={`tabular text-sm font-bold ${tone(item.changeRate)}`}>{signed(item.changeRate)}</p> : kind === "popular" ? <ChevronRight size={17} className="text-slate-300"/> : <p className="tabular text-xs font-semibold text-slate-600">{compact(item.value)}</p>} {kind !== "popular" && <p className={`tabular mt-1 text-[10px] ${tone(item.changeRate)}`}>{signed(item.changeRate)}</p>}</div></button></li>)}</ol></section>)}</div>}
      <p className="mt-4 text-center text-[10px] leading-4 text-slate-400">현재 선택한 {environmentLabel(environment)} 환경의 순위입니다.</p>
  </div>;
}

function StockSearch({ environment, onSelect }: { environment: Environment; onSelect: (stock: Stock) => void }) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const searchQuery = useQuery({ queryKey: ["stocks", environment, submitted], queryFn: () => fetchStocks(environment, submitted), enabled: submitted.length > 0 });
  const domestic = isDomestic(environment);
  const submit = (event: FormEvent) => { event.preventDefault(); const value = input.trim(); if (value) setSubmitted(value); };
  return <div>
    <div className="mb-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500"/>{environmentLabel(environment)}</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">종목 검색</h1><p className="mt-2 text-sm text-slate-500">종목명 또는 종목코드로 검색하세요.</p></div>
    <section className="rounded-2xl border border-[#dbe4df] bg-white p-5 shadow-[0_8px_24px_rgba(26,55,43,.05)] md:p-7">
      <div className="mb-5"><p className="mb-2 text-xs font-bold text-slate-500">시장 카테고리</p><div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button disabled={!domestic} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${domestic ? "bg-white text-[#173f31] shadow-sm" : "cursor-not-allowed text-slate-300"}`}><Building2 size={16}/>국내</button>
        <button disabled={domestic} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${!domestic ? "bg-white text-[#173f31] shadow-sm" : "cursor-not-allowed text-slate-300"}`}><Globe2 size={16}/>해외</button>
      </div><p className="mt-2 text-[11px] text-slate-400">현재 선택한 투자 환경의 시장 카테고리입니다.</p></div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row"><label className="relative flex-1"><span className="sr-only">종목명 또는 종목코드</span><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input value={input} onChange={(e) => setInput(e.target.value)} placeholder={domestic ? "예: 삼성전자, 005930" : "예: 애플, AAPL"} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-700 focus:bg-white"/></label><button disabled={!input.trim() || searchQuery.isFetching} className="h-12 rounded-xl bg-[#173f31] px-6 text-sm font-bold text-white disabled:opacity-50">{searchQuery.isFetching ? "검색 중" : "검색"}</button></form>
      <RecentStockSearches latestSearch={submitted} onSearch={(search) => { setInput(search); setSubmitted(search); }}/>
    </section>
    {searchQuery.isError && <div className="mt-5"><ErrorState message={searchQuery.error.message} retry={() => searchQuery.refetch()}/></div>}
    {searchQuery.data && <section className="mt-5 overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_8px_24px_rgba(26,55,43,.05)]"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">검색 결과</h2><p className="mt-1 text-xs text-slate-500">‘{searchQuery.data.query}’ · {searchQuery.data.results.length}개 · TR {searchQuery.data.trId}</p></div></div>{searchQuery.data.results.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><Search className="mx-auto mb-3 text-slate-300" size={32}/><p className="font-semibold text-slate-600">일치하는 종목이 없습니다</p><p className="mt-1 text-sm text-slate-400">종목명이나 코드를 다시 확인해 주세요.</p></div></div> : <ul className="divide-y divide-slate-100">{searchQuery.data.results.map((stock, index) => <li key={`${stock.marketCode}-${stock.code}-${index}`}><button onClick={() => onSelect(stock)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50 focus:bg-slate-50"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ef] text-emerald-800">{domestic ? <Building2 size={18}/> : <Globe2 size={18}/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-800">{stock.name}</p>{stock.isEtf && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">ETF</span>}</div>{stock.englishName && <p className="mt-0.5 truncate text-xs text-slate-400">{stock.englishName}</p>}</div><div className="text-right"><p className="tabular text-sm font-bold text-slate-700">{stock.code}</p><p className="mt-1 text-[11px] text-slate-400">{stock.market}{stock.industry ? ` · ${stock.industry}` : ""}</p></div><ChevronRight className="shrink-0 text-slate-300" size={17}/></button></li>)}</ul>}</section>}
    {!submitted && <div className="mt-5 grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/50 p-8 text-center"><div><Search className="mx-auto mb-3 text-slate-300" size={34}/><p className="font-semibold text-slate-600">검색어를 입력해 주세요</p><p className="mt-1 text-sm text-slate-400">검색 결과는 종목 목록으로만 표시됩니다.</p></div></div>}
  </div>;
}

function Loading() { return <div aria-live="polite"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white/80"/>)}</div><div className="mt-5 h-80 animate-pulse rounded-2xl border border-slate-200 bg-white/80"/></div> }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"><AlertCircle className="mx-auto mb-3 text-amber-600"/><h2 className="font-bold text-slate-800">계좌를 불러올 수 없습니다</h2><p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">{message}</p><button onClick={retry} className="mt-5 rounded-xl bg-[#173f31] px-4 py-2 text-sm font-bold text-white">다시 시도</button></div> }

function AccountView({ data, fetching, onSell }: { data: AccountData; fetching: boolean; onSell?: (position: Position) => void }) {
  const investmentCards = [
    [data.currency === "KRW" ? "추정 자산" : "총 평가금액", money(data.estimatedAssets ?? data.totalEvaluation, data.currency)],
    ["총 매입금액", money(data.totalPurchase, data.currency)],
    ["평가 손익", money(data.totalProfitLoss, data.currency)],
    ["총 수익률", signed(data.totalReturnRate)],
  ];
  const cashCards = data.cash ? [
    ["USD 예수금", money(data.cash.usdDeposit, "USD")],
    ["USD 출금가능", money(data.cash.usdWithdrawable, "USD")],
    ["USD 주문가능", money(data.cash.usdOrderable, "USD")],
    ["원화 예수금", money(data.cash.krwDeposit, "KRW")],
  ] : null;
  return <div className={fetching ? "opacity-70 transition" : "transition"}>
    {cashCards && <section className="mb-5"><div className="mb-3 flex items-center gap-2"><CircleDollarSign size={17} className="text-emerald-800"/><h2 className="text-sm font-bold text-slate-800">계좌 잔고</h2><span className="text-[11px] text-slate-400">해외주식 예수금</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cashCards.map(([label, value]) => <article key={label} className="rounded-2xl border border-[#cddfd5] bg-[#f8fbf9] p-5 shadow-[0_8px_24px_rgba(26,55,43,.04)]"><div className="mb-6 flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e2ece6] text-emerald-800"><CircleDollarSign size={15}/></span></div><p className="tabular text-xl font-bold tracking-tight text-slate-900">{value}</p></article>)}</div></section>}
    <div className="mb-3 flex items-center gap-2"><BarChart3 size={17} className="text-emerald-800"/><h2 className="text-sm font-bold text-slate-800">투자 현황</h2></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{investmentCards.map(([label, value], index) => <article key={label} className="rounded-2xl border border-[#dbe4df] bg-white p-5 shadow-[0_8px_24px_rgba(26,55,43,.05)]"><div className="mb-6 flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#edf3ef] text-emerald-800">{index < 2 ? <WalletCards size={15}/> : <BarChart3 size={15}/>}</span></div><p className={`tabular text-xl font-bold tracking-tight ${index > 1 ? tone(index === 2 ? data.totalProfitLoss : data.totalReturnRate) : "text-slate-900"}`}>{value}</p></article>)}</div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_8px_24px_rgba(26,55,43,.05)]"><div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">보유 종목</h2><p className="mt-1 text-xs text-slate-500">{data.positions.length}개 종목 · TR {data.trId}</p></div><div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Clock3 size={13}/>{new Date(data.fetchedAt).toLocaleString("ko-KR")} 기준</div></div>
      {data.positions.length === 0 ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><BriefcaseBusiness className="mx-auto mb-3 text-slate-300" size={32}/><p className="font-semibold text-slate-600">보유 종목이 없습니다</p><p className="mt-1 text-sm text-slate-400">새로고침하면 최신 계좌 상태를 확인합니다.</p></div></div> : <div className="overflow-x-auto"><table className="mobile-table w-full text-left"><thead><tr className="bg-[#f7f9f7] text-[11px] font-bold text-slate-500">{["종목", "보유 수량", "평균 단가", "현재가", "평가금액", "평가손익", "수익률", ...(onSell ? ["거래"] : [])].map(h => <th key={h} className="px-5 py-3 first:text-left text-right">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.positions.map(p => <tr key={`${p.market}-${p.code}`} className="hover:bg-slate-50/70"><td className="px-5 py-4"><p className="font-bold text-slate-800">{p.name}</p><p className="mt-1 text-[11px] text-slate-400">{p.code}{p.market ? ` · ${p.market}` : ""}</p></td><td className="tabular px-5 py-4 text-right text-sm">{number(p.quantity)}</td><td className="tabular px-5 py-4 text-right text-sm">{money(p.averagePrice, data.currency)}</td><td className="tabular px-5 py-4 text-right text-sm">{money(p.currentPrice, data.currency)}</td><td className="tabular px-5 py-4 text-right text-sm font-semibold">{money(p.evaluationAmount, data.currency)}</td><td className={`tabular px-5 py-4 text-right text-sm font-semibold ${tone(p.profitLoss)}`}>{money(p.profitLoss, data.currency)}</td><td className={`tabular px-5 py-4 text-right text-sm font-bold ${tone(p.returnRate)}`}>{signed(p.returnRate)}</td>{onSell && <td className="px-5 py-4 text-right"><button onClick={() => onSell(p)} disabled={p.availableQuantity <= 0} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40">매도</button></td>}</tr>)}</tbody></table></div>}
    </section>
  </div>;
}

export function Dashboard() { return <QueryProvider><DashboardContent/></QueryProvider>; }
