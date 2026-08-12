"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Globe2, Star, Trash2 } from "lucide-react";
import type { TradableStock } from "./StockTradePanel";

const STORAGE_KEY = "kiwoom-ledger:watchlist:v1";

export type WatchlistMarket = "domestic" | "overseas";
export type WatchlistItem = TradableStock & { category: WatchlistMarket };

const itemKey = (item: Pick<WatchlistItem, "category" | "marketCode" | "code">) =>
  `${item.category}:${item.marketCode}:${item.code}`;

function readWatchlist(): WatchlistItem[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WatchlistItem => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<WatchlistItem>;
      return (candidate.category === "domestic" || candidate.category === "overseas") &&
        typeof candidate.code === "string" && typeof candidate.name === "string" &&
        typeof candidate.market === "string" && typeof candidate.marketCode === "string";
    });
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems(readWatchlist());
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Keep the in-memory list usable when browser storage is unavailable.
    }
  }, [items, loaded]);

  const keys = useMemo(() => new Set(items.map(itemKey)), [items]);
  const isSaved = useCallback((stock: TradableStock, category: WatchlistMarket) =>
    keys.has(itemKey({ ...stock, category })), [keys]);
  const toggle = useCallback((stock: TradableStock, category: WatchlistMarket) => {
    const key = itemKey({ ...stock, category });
    setItems((current) => current.some((item) => itemKey(item) === key)
      ? current.filter((item) => itemKey(item) !== key)
      : [...current, { ...stock, category }]);
  }, []);

  return { items, isSaved, toggle };
}

export function WatchlistButton({ stock, category, saved, onToggle }: {
  stock: TradableStock;
  category: WatchlistMarket;
  saved: boolean;
  onToggle: (stock: TradableStock, category: WatchlistMarket) => void;
}) {
  const label = saved ? `${stock.name} 관심종목 삭제` : `${stock.name} 관심종목 추가`;
  return <button type="button" onClick={() => onToggle(stock, category)} aria-label={label} title={label}
    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition ${saved ? "border-amber-200 bg-amber-50 text-amber-500" : "border-slate-200 text-slate-400 hover:border-amber-200 hover:text-amber-500"}`}>
    <Star size={17} fill={saved ? "currentColor" : "none"}/>
  </button>;
}

export function WatchlistView({ items, onSelect, onRemove }: {
  items: WatchlistItem[];
  onSelect: (stock: TradableStock) => void;
  onRemove: (stock: TradableStock, category: WatchlistMarket) => void;
}) {
  return <div>
    <div className="mb-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-800"><Star size={14} fill="currentColor"/>브라우저에 저장됨</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">관심종목</h1><p className="mt-2 text-sm text-slate-500">검색과 순위에서 저장한 종목을 한곳에서 확인하세요.</p></div>
    <section className="overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_8px_24px_rgba(26,55,43,.05)]">
      <header className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">저장된 종목</h2><p className="mt-1 text-xs text-slate-500">이 브라우저에 {items.length}개 저장</p></header>
      {items.length === 0 ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><Star className="mx-auto mb-3 text-slate-300" size={34}/><p className="font-semibold text-slate-600">관심종목이 없습니다</p><p className="mt-1 text-sm text-slate-400">검색 또는 순위 화면의 별을 눌러 추가하세요.</p></div></div> :
        <ul className="divide-y divide-slate-100">{items.map((stock) => <li key={itemKey(stock)} className="flex items-center gap-2 px-3 sm:px-5"><button onClick={() => onSelect(stock)} className="flex min-w-0 flex-1 items-center gap-4 py-4 text-left hover:bg-slate-50"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ef] text-emerald-800">{stock.category === "domestic" ? <Building2 size={18}/> : <Globe2 size={18}/>}</div><div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-800">{stock.name}</p><p className="mt-1 truncate text-xs text-slate-400">{stock.code} · {stock.market}</p></div></button><button onClick={() => onRemove(stock, stock.category)} aria-label={`${stock.name} 관심종목 삭제`} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={17}/></button></li>)}</ul>}
    </section>
  </div>;
}
