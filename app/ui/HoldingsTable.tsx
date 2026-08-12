"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type HoldingPosition = {
  code: string;
  name: string;
  market?: string;
  marketCode: string;
  quantity: number;
  availableQuantity: number;
  averagePrice: number;
  currentPrice: number;
  purchaseAmount: number;
  evaluationAmount: number;
  profitLoss: number;
  returnRate: number;
};

type SortKey = "name" | "evaluationAmount" | "profitLoss" | "returnRate";
type SortDirection = "ascending" | "descending";

const sortableColumns: { key: SortKey; label: string }[] = [
  { key: "name", label: "종목" },
  { key: "evaluationAmount", label: "평가금액" },
  { key: "profitLoss", label: "평가손익" },
  { key: "returnRate", label: "수익률" },
];

export function HoldingsTable({ positions, currency, onSell }: { positions: HoldingPosition[]; currency: "KRW" | "USD"; onSell?: (position: HoldingPosition) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "ascending" });
  const sortedPositions = useMemo(() => positions.map((position, index) => ({ position, index })).sort((a, b) => {
    const left = a.position[sort.key];
    const right = b.position[sort.key];
    const comparison = typeof left === "string" ? left.localeCompare(String(right), "ko-KR") : left - Number(right);
    return (sort.direction === "ascending" ? comparison : -comparison) || a.index - b.index;
  }).map(({ position }) => position), [positions, sort]);

  const changeSort = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending",
  }));
  const formatMoney = (value: number) => new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(value);
  const formatNumber = (value: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
  const formatRate = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const valueTone = (value: number) => value > 0 ? "text-rose-600" : value < 0 ? "text-blue-600" : "text-slate-500";
  const sortableHeader = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = active ? sort.direction === "ascending" ? ArrowUp : ArrowDown : ArrowUpDown;
    return <th key={key} className={`px-5 py-3 ${key === "name" ? "text-left" : "text-right"}`} aria-sort={active ? sort.direction : "none"}><button type="button" onClick={() => changeSort(key)} className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 hover:bg-slate-100" aria-label={`${label} ${active && sort.direction === "ascending" ? "내림차순" : "오름차순"} 정렬`}>{label}<Icon size={13} aria-hidden="true"/></button></th>;
  };

  return <div className="overflow-x-auto"><table className="mobile-table w-full text-left"><thead><tr className="bg-[#f7f9f7] text-[11px] font-bold text-slate-500">
    {sortableHeader("name", "종목")}
    <th className="px-5 py-3 text-right">보유 수량</th><th className="px-5 py-3 text-right">평균 단가</th><th className="px-5 py-3 text-right">현재가</th>
    {sortableColumns.slice(1).map(({ key, label }) => sortableHeader(key, label))}
    {onSell && <th className="px-5 py-3 text-right">거래</th>}
  </tr></thead><tbody className="divide-y divide-slate-100">{sortedPositions.map((position) => <tr key={`${position.market}-${position.code}`} className="hover:bg-slate-50/70"><td className="px-5 py-4"><p className="font-bold text-slate-800">{position.name}</p><p className="mt-1 text-[11px] text-slate-400">{position.code}{position.market ? ` · ${position.market}` : ""}</p></td><td className="tabular px-5 py-4 text-right text-sm">{formatNumber(position.quantity)}</td><td className="tabular px-5 py-4 text-right text-sm">{formatMoney(position.averagePrice)}</td><td className="tabular px-5 py-4 text-right text-sm">{formatMoney(position.currentPrice)}</td><td className="tabular px-5 py-4 text-right text-sm font-semibold">{formatMoney(position.evaluationAmount)}</td><td className={`tabular px-5 py-4 text-right text-sm font-semibold ${valueTone(position.profitLoss)}`}>{formatMoney(position.profitLoss)}</td><td className={`tabular px-5 py-4 text-right text-sm font-bold ${valueTone(position.returnRate)}`}>{formatRate(position.returnRate)}</td>{onSell && <td className="px-5 py-4 text-right"><button onClick={() => onSell(position)} disabled={position.availableQuantity <= 0} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40">매도</button></td>}</tr>)}</tbody></table></div>;
}
