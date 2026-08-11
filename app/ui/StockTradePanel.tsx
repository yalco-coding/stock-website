"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, ShoppingCart, X } from "lucide-react";

export type TradableStock = { code: string; name: string; englishName?: string; market: string; marketCode: string; industry?: string; isEtf?: boolean };
type Environment = "real-domestic" | "real-overseas" | "mock-domestic" | "mock-overseas";
type Detail = { trId: string; marketCode: string; code: string; name: string; englishName?: string; currency: "KRW" | "USD"; currentPrice: number; change: number; changeRate: number; openPrice: number; highPrice: number; lowPrice: number; volume: number; suspended: boolean };
type OrderResult = { orderNo: string; message: string; trId: string; marketCode?: string };
type OrderStatus = { trId: string; status: "pending" | "partial" | "filled"; label: string; orderedQuantity?: number; filledQuantity: number; remainingQuantity: number; filledPrice?: number };

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  const resolved = await response;
  const body = await resolved.json() as T & { message?: string };
  if (!resolved.ok) throw new Error(body.message || "요청을 처리하지 못했습니다.");
  return body;
}

export function StockTradePanel({ stock, environment, mode = "buy", holding, onClose }: { stock: TradableStock | null; environment: Environment; mode?: "buy" | "sell"; holding?: { quantity: number; availableQuantity: number }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(mode === "sell" ? Math.min(holding?.availableQuantity ?? 1, 1) : 1);
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("");
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const real = environment.startsWith("real-");
  const domestic = environment.endsWith("domestic");
  const supported = !real && !!stock && (mode === "sell" ? (holding?.availableQuantity ?? 0) > 0 : domestic ? stock.marketCode === "KRX" : ["NA", "ND", "NY"].includes(stock.marketCode));
  const unsupportedReason = real ? "실투자 매수·매도 기능은 비활성화되어 있습니다." : domestic ? "국내 모의투자는 KRX 종목만 매수할 수 있습니다." : "해외 모의투자는 NASDAQ·NYSE·AMEX 종목만 매수할 수 있습니다.";

  const detail = useQuery({
    queryKey: ["stock-detail", environment, stock?.marketCode, stock?.code],
    queryFn: () => json<Detail>(fetch(`/api/stocks/detail?environment=${environment}&code=${encodeURIComponent(stock!.code)}&marketCode=${encodeURIComponent(stock!.marketCode)}`, { cache: "no-store" })),
    enabled: !!stock,
  });
  const effectivePrice = Number(price || detail.data?.currentPrice || 0);

  const buy = useMutation({
    mutationFn: () => json<OrderResult>(fetch(`/api/orders/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment, requestId: confirmationId, code: stock?.code, marketCode: detail.data?.marketCode || stock?.marketCode, quantity, orderType, price: orderType === "limit" ? effectivePrice : undefined }) })),
    onSuccess: (result) => { setOrder(result); setConfirmationId(null); setNotice({ type: "success", text: `${result.message} 주문번호 ${result.orderNo}` }); queryClient.invalidateQueries({ queryKey: ["account", environment] }); },
    onError: (error) => { setConfirmationId(null); setNotice({ type: "error", text: error.message }); },
  });
  const status = useQuery({
    queryKey: ["order-status", environment, mode, order?.orderNo, stock?.code],
    queryFn: () => json<OrderStatus>(fetch(`/api/orders/status?environment=${environment}&side=${mode}&orderNo=${encodeURIComponent(order!.orderNo)}&code=${encodeURIComponent(stock!.code)}&marketCode=${encodeURIComponent(order?.marketCode || detail.data?.marketCode || stock!.marketCode)}`, { cache: "no-store" })),
    enabled: !!order && !!stock,
    refetchInterval: (query) => query.state.data?.status === "filled" ? false : 5_000,
  });

  if (!stock) return null;
  const currency = detail.data?.currency ?? (domestic ? "KRW" : "USD");
  const formatMoney = (value: number) => new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 4 }).format(value);
  const canConfirm = supported && !detail.data?.suspended && quantity >= 1 && Number.isInteger(quantity) && (mode === "buy" || quantity <= (holding?.availableQuantity ?? 0)) && (orderType === "market" || effectivePrice > 0) && !buy.isPending;

  return <><button className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px]" onClick={onClose} aria-label="거래 패널 닫기"/><aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-[#f7f9f7] shadow-2xl" role="dialog" aria-modal="true" aria-label={`${stock.name} 거래 패널`}>
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-[10px] font-bold tracking-[.16em] text-emerald-800">STOCK TRADE</p><h2 className="mt-1 text-lg font-bold text-slate-900">종목 거래</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="닫기"><X size={20}/></button></header>
    <div className="space-y-5 p-5">
      {notice && <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>{notice.type === "success" ? <CheckCircle2 className="mt-0.5 shrink-0" size={18}/> : <AlertCircle className="mt-0.5 shrink-0" size={18}/>}<span>{notice.text}</span></div>}
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-bold text-slate-900">{stock.name}</h3>{stock.isEtf && <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">ETF</span>}</div><p className="mt-1 text-xs text-slate-400">{stock.code} · {stock.market}</p>{stock.englishName && <p className="mt-1 text-xs text-slate-400">{stock.englishName}</p>}</div>{detail.isFetching && <RefreshCw className="animate-spin text-slate-400" size={17}/>}</div>
        {detail.isError && <p className="mt-4 text-sm text-rose-600">{detail.error.message}</p>}
        {detail.data && <><div className="mt-5 flex items-end justify-between"><div><p className="text-xs text-slate-500">현재가</p><p className="tabular mt-1 text-2xl font-bold text-slate-900">{formatMoney(detail.data.currentPrice)}</p></div><p className={`tabular text-sm font-bold ${detail.data.changeRate > 0 ? "text-rose-600" : detail.data.changeRate < 0 ? "text-blue-600" : "text-slate-500"}`}>{detail.data.changeRate > 0 ? "+" : ""}{detail.data.changeRate.toFixed(2)}%</p></div><dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center"><div><dt className="text-[11px] text-slate-400">시가</dt><dd className="tabular mt-1 text-xs font-semibold">{formatMoney(detail.data.openPrice)}</dd></div><div><dt className="text-[11px] text-slate-400">고가</dt><dd className="tabular mt-1 text-xs font-semibold">{formatMoney(detail.data.highPrice)}</dd></div><div><dt className="text-[11px] text-slate-400">저가</dt><dd className="tabular mt-1 text-xs font-semibold">{formatMoney(detail.data.lowPrice)}</dd></div></dl><p className="mt-3 text-[10px] text-slate-400">TR {detail.data.trId}</p></>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center gap-2"><ShoppingCart size={18} className="text-emerald-800"/><h3 className="font-bold text-slate-900">{real ? "실투자 주문" : `모의투자 ${mode === "sell" ? "매도" : "매수"}`}</h3></div>
        {mode === "sell" && holding && <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm"><div><p className="text-[11px] text-slate-400">보유수량</p><p className="tabular mt-1 font-bold text-slate-800">{holding.quantity}주</p></div><div><p className="text-[11px] text-slate-400">매도 가능</p><p className="tabular mt-1 font-bold text-emerald-800">{holding.availableQuantity}주</p></div></div>}
        {!supported ? <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{mode === "sell" ? "매도 가능한 보유수량이 없습니다." : unsupportedReason}</div> : detail.data?.suspended ? <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">거래정지 종목은 주문할 수 없습니다.</div> : <div className="space-y-4"><div><p className="mb-2 text-xs font-bold text-slate-500">주문 유형</p><div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">{(["limit", "market"] as const).map((type) => <button key={type} onClick={() => setOrderType(type)} className={`rounded-lg py-2 text-sm font-bold ${orderType === type ? "bg-white text-[#173f31] shadow-sm" : "text-slate-500"}`}>{type === "limit" ? "지정가" : "시장가"}</button>)}</div></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">수량<input type="number" min="1" max={mode === "sell" ? holding?.availableQuantity : undefined} step="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-emerald-700"/></label><label className="text-xs font-bold text-slate-500">주문가격<input type="number" min="0" step={currency === "KRW" ? "1" : effectivePrice < 1 ? "0.0001" : "0.01"} value={price || detail.data?.currentPrice || ""} disabled={orderType === "market"} onChange={(e) => setPrice(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal outline-none focus:border-emerald-700 disabled:bg-slate-100 disabled:text-slate-400"/></label></div>{mode === "sell" && quantity > (holding?.availableQuantity ?? 0) && <p className="text-[11px] font-semibold text-rose-600">매도 가능 수량을 초과했습니다.</p>}{currency === "USD" && orderType === "limit" && <p className="text-[11px] text-slate-400">$1 미만은 소수점 4자리, $1 이상은 소수점 2자리로 주문됩니다.</p>}<div className="rounded-xl bg-slate-50 px-4 py-3 text-sm"><div className="flex justify-between"><span className="text-slate-500">예상 주문금액</span><strong className="tabular text-slate-800">{orderType === "limit" && effectivePrice > 0 ? formatMoney(effectivePrice * quantity) : "시장가 체결 기준"}</strong></div></div><button onClick={() => setConfirmationId(crypto.randomUUID())} disabled={!canConfirm} className="h-12 w-full rounded-xl bg-[#173f31] text-sm font-bold text-white disabled:opacity-40">{mode === "sell" ? "매도" : "매수"} 주문 확인</button></div>}
      </section>
      {order && <section className="rounded-2xl border border-emerald-200 bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Clock3 size={18} className="text-emerald-800"/><h3 className="font-bold text-slate-900">주문 상태</h3></div>{status.isFetching && <RefreshCw className="animate-spin text-slate-400" size={15}/>}</div><p className="mt-4 text-sm font-bold text-slate-800">{status.data?.label ?? "체결 상태 확인 중"}</p>{status.data && <p className="mt-2 text-xs text-slate-500">체결 {status.data.filledQuantity}주 · 잔량 {status.data.remainingQuantity}주 · TR {status.data.trId}</p>}{status.isError && <p className="mt-2 text-xs text-rose-600">{status.error.message}</p>}</section>}
      <div className="flex items-start gap-2 rounded-xl bg-[#e8efeb] p-4 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-800" size={16}/>모의투자 주문만 전송됩니다. 동일한 확인 요청은 서버에서 한 번만 처리합니다.</div>
    </div>
  </aside>{confirmationId && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" role="alertdialog" aria-modal="true"><h3 className="text-lg font-bold text-slate-900">{mode === "sell" ? "매도" : "매수"} 주문을 확인해 주세요</h3><div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><p className="flex justify-between"><span className="text-slate-500">종목</span><strong>{stock.name} ({stock.code})</strong></p><p className="flex justify-between"><span className="text-slate-500">주문</span><strong>{quantity}주 · {orderType === "limit" ? "지정가" : "시장가"}</strong></p>{orderType === "limit" && <p className="flex justify-between"><span className="text-slate-500">가격</span><strong>{formatMoney(effectivePrice)}</strong></p>}</div><p className="mt-4 text-xs leading-5 text-amber-700">확인하면 서버가 잔고를 다시 확인한 뒤 모의투자 계좌에 실제 주문을 전송합니다.</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => setConfirmationId(null)} disabled={buy.isPending} className="h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">취소</button><button onClick={() => buy.mutate()} disabled={buy.isPending} className="h-11 rounded-xl bg-[#173f31] text-sm font-bold text-white disabled:opacity-60">{buy.isPending ? "주문 전송 중" : `최종 ${mode === "sell" ? "매도" : "매수"}`}</button></div></div></div>}</>;
}
