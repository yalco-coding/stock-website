"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CirclePause, LoaderCircle, Radio } from "lucide-react";

type EnvironmentHealth = { environment: "mock-domestic" | "mock-overseas"; state: string; message: string; lastSyncAt: string | null };
type RuntimePosition = { environment: "mock-domestic" | "mock-overseas"; marketCode: string; code: string; quantity: number; paused: boolean; pauseReason: string | null };
type RuntimeStatus = { mode: "off" | "shadow" | "mock"; environments: EnvironmentHealth[]; positions: RuntimePosition[]; activeOrders: { orderNo: string | null; state: string; code?: string; needsAttention: boolean }[] };

async function getStatus() {
  const response = await fetch("/api/strategies/status", { cache: "no-store" });
  const body = await response.json() as RuntimeStatus & { message?: string };
  if (!response.ok) throw new Error(body.message || "전략 실행 상태를 불러오지 못했습니다.");
  return body;
}

export function StrategyRuntimeStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["strategy-runtime-status"], queryFn: getStatus, refetchInterval: 5_000 });
  const resume = useMutation({
    mutationFn: async (position: RuntimePosition) => {
      const response = await fetch("/api/strategies/positions/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || "종목을 재개하지 못했습니다.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["strategy-runtime-status"] }),
  });
  const paused = query.data?.positions.filter((position) => position.paused && position.quantity > 0) ?? [];
  return <div className="mt-6 border-t border-slate-100 pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Radio size={16} className="text-emerald-700"/><h3 className="text-sm font-bold text-slate-800">공용 실행기 상태</h3></div>{query.isFetching && <LoaderCircle size={15} className="animate-spin text-slate-400"/>}</div>
    {query.isError ? <p className="mt-3 text-xs text-rose-600">{query.error.message}</p> : query.data && <>
      <p className="mt-2 text-xs text-slate-500">모드 <strong>{query.data.mode}</strong> · {query.data.mode === "off" ? "주문과 신호 평가가 꺼져 있습니다." : query.data.mode === "shadow" ? "신호만 기록하고 주문하지 않습니다." : "모의투자 주문만 허용합니다."}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{query.data.environments.map((health) => <div key={health.environment} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><div className="flex justify-between gap-2"><span className="font-bold text-slate-700">{health.environment === "mock-domestic" ? "국내 모의" : "미국 모의"}</span><span className={health.state === "ready" ? "text-emerald-700" : "text-amber-700"}>{health.state}</span></div><p className="mt-1 text-slate-500">{health.message}</p></div>)}</div>
      {paused.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-900"><CirclePause size={15}/>사용자 확인이 필요한 종목</div><div className="space-y-2">{paused.map((position) => <div key={`${position.environment}:${position.marketCode}:${position.code}`} className="flex items-start justify-between gap-3 text-xs"><div><strong>{position.code}</strong><p className="mt-0.5 text-amber-800">{position.pauseReason}</p></div><button disabled={resume.isPending} onClick={() => resume.mutate(position)} className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-bold text-amber-900 disabled:opacity-50">재확인 후 재개</button></div>)}</div></div>}
      {query.data.activeOrders.some((order) => order.needsAttention) && <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-800"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>확인이 필요한 주문이 있어 해당 종목의 새 매도를 막고 있습니다.</p>}
      {resume.isError && <p className="mt-2 text-xs text-rose-600">{resume.error.message}</p>}
    </>}
  </div>;
}
