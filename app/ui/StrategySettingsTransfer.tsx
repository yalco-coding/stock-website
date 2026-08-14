"use client";

import { CheckCircle2, Clipboard, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StrategySettings } from "../strategy-settings";

type SettingsResponse = { settings?: StrategySettings; revision?: number; message?: string };

export function StrategySettingsTransfer() {
  const [exportJson, setExportJson] = useState("");
  const [importJson, setImportJson] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const exportField = useRef<HTMLTextAreaElement>(null);

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/strategies", { cache: "no-store" });
      const body = await response.json() as SettingsResponse;
      if (!response.ok || !body.settings) throw new Error(body.message || "전략 설정을 불러오지 못했습니다.");
      setExportJson(JSON.stringify(body.settings, null, 2));
      setRevision(body.revision ?? body.settings.revision);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "전략 설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/settings/strategies", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as SettingsResponse;
        if (!response.ok || !body.settings) throw new Error(body.message || "전략 설정을 불러오지 못했습니다.");
        return body as SettingsResponse & { settings: StrategySettings };
      })
      .then((body) => {
        setExportJson(JSON.stringify(body.settings, null, 2));
        setRevision(body.revision ?? body.settings.revision);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "전략 설정을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  async function copySettings() {
    setNotice("");
    setError("");
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(exportJson);
      } else {
        exportField.current?.focus();
        exportField.current?.select();
        if (!document.execCommand("copy")) throw new Error("브라우저가 자동 복사를 허용하지 않습니다.");
      }
      setNotice("전체 전략 설정 JSON을 복사했습니다.");
    } catch (copyError) {
      exportField.current?.focus();
      exportField.current?.select();
      setError(copyError instanceof Error ? `${copyError.message} 선택된 텍스트를 직접 복사해 주세요.` : "선택된 텍스트를 직접 복사해 주세요.");
    }
  }

  async function importSettings() {
    setNotice("");
    setError("");
    let settings: unknown;
    try {
      settings = JSON.parse(importJson);
    } catch {
      setError("붙여넣은 내용이 올바른 JSON이 아닙니다.");
      return;
    }
    if (revision === null) {
      setError("현재 서버의 설정을 먼저 불러와 주세요.");
      return;
    }
    if (!window.confirm("현재 서버의 전체 전략 설정을 붙여넣은 내용으로 교체할까요? 켜져 있는 모의투자 전략도 함께 적용됩니다.")) return;

    setImporting(true);
    try {
      const response = await fetch("/api/settings/strategies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, expectedRevision: revision }),
      });
      const body = await response.json() as SettingsResponse;
      if (response.status === 409 && body.settings) {
        setExportJson(JSON.stringify(body.settings, null, 2));
        setRevision(body.revision ?? body.settings.revision);
        throw new Error("이 서버의 설정이 방금 변경되었습니다. 최신 상태를 불러왔으니 내용을 확인한 뒤 다시 적용해 주세요.");
      }
      if (!response.ok || !body.settings) throw new Error(body.message || "전략 설정을 가져오지 못했습니다.");
      setExportJson(JSON.stringify(body.settings, null, 2));
      setRevision(body.revision ?? body.settings.revision);
      setImportJson("");
      setNotice("붙여넣은 전체 전략 설정을 이 서버에 적용했습니다.");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "전략 설정을 가져오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  return <div className="mx-auto max-w-5xl">
    <div className="mb-7"><div className="mb-2 text-xs font-semibold text-emerald-800">STRATEGY SETTINGS</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">전략 설정 옮기기</h1><p className="mt-2 text-sm leading-6 text-slate-500">현재 서버의 전략 설정 JSON을 복사해 다른 서버의 입력란에 붙여넣을 수 있습니다. 인증정보와 텔레그램 설정은 포함되지 않습니다.</p></div>
    {(notice || error) && <div aria-live="polite" className={`mb-5 flex items-start gap-2 rounded-xl border p-4 text-sm font-semibold ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}><CheckCircle2 className="mt-0.5 shrink-0" size={17}/><p>{error || notice}</p></div>}
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-[#dbe4df] bg-white p-5 shadow-[0_8px_24px_rgba(26,55,43,.05)] md:p-6">
        <div className="mb-4"><h2 className="font-bold text-slate-900">1. 이 서버에서 복사</h2><p className="mt-1 text-xs leading-5 text-slate-500">SL / TP, 트레일링 스탑, 데드크로스의 국내·해외 설정과 제외종목을 모두 내보냅니다.</p></div>
        {loading ? <div className="grid min-h-72 place-items-center rounded-xl bg-slate-50"><LoaderCircle className="animate-spin text-emerald-800"/></div> : <textarea ref={exportField} readOnly value={exportJson} aria-label="전체 전략 설정 JSON" spellCheck={false} className="min-h-72 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-emerald-700"/>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copySettings()} disabled={loading || !exportJson} className="inline-flex items-center gap-2 rounded-xl bg-[#173f31] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Clipboard size={16}/>JSON 복사</button><button type="button" onClick={() => void loadSettings()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>새로고침</button></div>
      </section>
      <section className="rounded-2xl border border-[#dbe4df] bg-white p-5 shadow-[0_8px_24px_rgba(26,55,43,.05)] md:p-6">
        <div className="mb-4"><h2 className="font-bold text-slate-900">2. 이 서버에 붙여넣기</h2><p className="mt-1 text-xs leading-5 text-slate-500">다른 서버에서 복사한 JSON을 붙여넣으면 이 서버의 전체 전략 설정을 교체합니다.</p></div>
        <textarea value={importJson} onChange={(event) => setImportJson(event.target.value)} aria-label="가져올 전체 전략 설정 JSON" placeholder="복사한 전략 설정 JSON을 여기에 붙여넣으세요." spellCheck={false} className="min-h-72 w-full resize-y rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 text-slate-700 outline-none placeholder:font-sans placeholder:text-slate-400 focus:border-emerald-700"/>
        <button type="button" onClick={() => void importSettings()} disabled={loading || importing || !importJson.trim()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#173f31] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{importing ? <LoaderCircle size={16} className="animate-spin"/> : <Upload size={16}/>}설정 적용</button>
        <p className="mt-3 text-xs leading-5 text-amber-700">적용 전에 확인 창이 표시됩니다. JSON의 revision 값은 복사 출처의 값이므로 이 서버에서는 새 revision으로 안전하게 저장합니다.</p>
      </section>
    </div>
  </div>;
}
