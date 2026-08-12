"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Clock3, X } from "lucide-react";

const STORAGE_KEY = "kiwoom-ledger:recent-stock-searches:v1";
const MAX_RECENT_SEARCHES = 10;

function readRecentSearches(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
}

function readStoredValue() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function saveRecentSearches(searches: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
    window.dispatchEvent(new Event(STORAGE_KEY));
  } catch {
    // 검색은 저장 공간이 차단되거나 가득 찬 경우에도 계속 사용할 수 있어야 합니다.
  }
}

export function RecentStockSearches({ latestSearch, onSearch }: { latestSearch: string; onSearch: (search: string) => void }) {
  const stored = useSyncExternalStore(
    (notify) => { window.addEventListener(STORAGE_KEY, notify); window.addEventListener("storage", notify); return () => { window.removeEventListener(STORAGE_KEY, notify); window.removeEventListener("storage", notify); }; },
    readStoredValue,
    () => "[]",
  );
  const searches = useMemo(() => {
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_RECENT_SEARCHES) : [];
    } catch {
      return [];
    }
  }, [stored]);

  useEffect(() => {
    const value = latestSearch.trim();
    if (!value) return;
    const current = readRecentSearches();
    saveRecentSearches([value, ...current.filter((item) => item !== value)].slice(0, MAX_RECENT_SEARCHES));
  }, [latestSearch]);

  const remove = (search: string) => saveRecentSearches(searches.filter((item) => item !== search));
  const clear = () => saveRecentSearches([]);

  if (searches.length === 0) return null;
  return <section className="mt-4 border-t border-slate-100 pt-4" aria-label="최근 검색어">
    <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={14}/>최근 검색어</div><button type="button" onClick={clear} className="text-xs font-semibold text-slate-400 hover:text-slate-700">전체 삭제</button></div>
    <ul className="flex flex-wrap gap-2">{searches.map((search) => <li key={search} className="flex items-center rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-700"><button type="button" onClick={() => onSearch(search)} className="max-w-52 truncate py-2 pl-3 pr-1 hover:text-emerald-800">{search}</button><button type="button" onClick={() => remove(search)} aria-label={`${search} 최근 검색어 삭제`} className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X size={13}/></button></li>)}</ul>
  </section>;
}
