"use client";

import { Download } from "lucide-react";
import { accountCsvFilename, createAccountCsv, type CsvPosition } from "./accountCsv";

export function AccountCsvDownload({ positions, currency, environment, fetchedAt }: {
  positions: CsvPosition[];
  currency: "KRW" | "USD";
  environment: string;
  fetchedAt: string;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([createAccountCsv(positions, currency)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = accountCsvFilename(environment, fetchedAt);
    link.click();
    URL.revokeObjectURL(url);
  };

  return <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-[#cad5cf] bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50" aria-label="보유 종목과 손익을 CSV로 다운로드">
    <Download size={14}/>
    CSV 다운로드
  </button>;
}
