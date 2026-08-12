"use client";

import { useState } from "react";

const KRW_BUDGETS = [100_000, 500_000, 1_000_000] as const;

type Props = {
  currency: "KRW" | "USD";
  max?: number;
  quantity: number;
  unitPrice: number;
  onChange: (quantity: number) => void;
};

export function OrderQuantityControls({ currency, max, quantity, unitPrice, onChange }: Props) {
  const [usdBudget, setUsdBudget] = useState("");
  const normalizedMax = max === undefined ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor(max));
  const setSafeQuantity = (next: number) => onChange(Math.min(normalizedMax, Math.max(1, Math.floor(next))));
  const applyBudget = (budget: number) => {
    if (budget > 0 && unitPrice > 0) setSafeQuantity(Math.floor(budget / unitPrice));
  };

  return <div className="space-y-2">
    <div className="flex gap-2">
      <button type="button" aria-label="수량 1 감소" onClick={() => setSafeQuantity(quantity - 1)} disabled={quantity <= 1} className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 text-lg font-bold text-slate-700 disabled:opacity-40">−1</button>
      <input aria-label="수량" type="number" min="1" max={max} step="1" value={quantity} onChange={(event) => onChange(Number(event.target.value))} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-emerald-700"/>
      <button type="button" aria-label="수량 1 증가" onClick={() => setSafeQuantity(quantity + 1)} disabled={quantity >= normalizedMax} className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 text-lg font-bold text-slate-700 disabled:opacity-40">+1</button>
    </div>
    {currency === "KRW" ? <div className="grid grid-cols-3 gap-1.5" aria-label="예산 기준 수량 계산">
      {KRW_BUDGETS.map((budget) => <button type="button" key={budget} onClick={() => applyBudget(budget)} disabled={unitPrice <= 0 || budget < unitPrice} className="rounded-lg bg-emerald-50 px-1 py-2 text-[11px] font-bold text-emerald-800 disabled:opacity-40">{budget / 10_000}만원</button>)}
    </div> : <div className="space-y-1.5">
      <div className="flex gap-2"><input aria-label="USD 예산" type="number" min="0" step="0.01" inputMode="decimal" placeholder="USD 예산 입력" value={usdBudget} onChange={(event) => setUsdBudget(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-emerald-700"/><button type="button" onClick={() => applyBudget(Number(usdBudget))} disabled={Number(usdBudget) < unitPrice || unitPrice <= 0} className="rounded-lg bg-emerald-50 px-3 text-xs font-bold text-emerald-800 disabled:opacity-40">수량 계산</button></div>
      <p className="text-[10px] font-normal leading-4 text-slate-400">환율을 추정하지 않고 입력한 USD 예산으로 계산합니다.</p>
    </div>}
  </div>;
}
