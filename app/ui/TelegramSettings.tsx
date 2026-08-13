"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCircle2, LoaderCircle, LogIn, ShoppingCart, Tags } from "lucide-react";

type Settings = { login: boolean; buyFilled: boolean; sellFilled: boolean };
type ResponseBody = { configured: boolean; settings: Settings; message?: string };
const rows = [
  { key: "login" as const, title: "로그인", description: "사이트에 성공적으로 로그인하면 알립니다.", icon: LogIn },
  { key: "buyFilled" as const, title: "매수 체결", description: "매수 주문이 전량 체결되면 알립니다.", icon: ShoppingCart },
  { key: "sellFilled" as const, title: "매도 체결", description: "매도 주문이 전량 체결되면 알립니다.", icon: Tags },
];

export function TelegramSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/settings/telegram", { cache: "no-store" })
      .then(async (response) => { const body = await response.json() as ResponseBody; if (!response.ok) throw new Error(body.message); return body; })
      .then((body) => { setSettings(body.settings); setConfigured(body.configured); })
      .catch(() => setNotice("알림 설정을 불러오지 못했습니다."));
  }, []);
  async function toggle(key: keyof Settings) {
    if (!settings || saving) return;
    const previous = settings;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next); setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/settings/telegram", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(body.message);
      setSettings(body.settings); setNotice("설정을 저장했습니다.");
    } catch { setSettings(previous); setNotice("설정을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  return <div className="mx-auto max-w-3xl">
    <div className="mb-7"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-800"><Bell size={14}/>TELEGRAM</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">텔레그램 알림</h1><p className="mt-2 text-sm text-slate-500">받고 싶은 이벤트만 선택하세요. 설정은 이 서버에 저장됩니다.</p></div>
    <section className="overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_8px_24px_rgba(26,55,43,.05)]">
      <div className={`flex items-center gap-3 border-b px-5 py-4 text-sm ${configured ? "border-emerald-100 bg-emerald-50 text-emerald-900" : "border-amber-100 bg-amber-50 text-amber-900"}`}><CheckCircle2 size={18}/><span className="font-semibold">{configured ? "Telegram 봇과 채팅방이 연결되어 있습니다." : "TELEGRAM_BOT_TOKEN과 TELEGRAM_CHAT_ID 설정이 필요합니다."}</span></div>
      {!settings ? <div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-emerald-800"/></div> : <div className="divide-y divide-slate-100">{rows.map(({ key, title, description, icon: Icon }) => <div key={key} className="flex items-center gap-4 px-5 py-5 sm:px-6"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ef] text-emerald-800"><Icon size={18}/></span><div className="min-w-0 flex-1"><h2 className="font-bold text-slate-800">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div><button type="button" role="switch" aria-checked={settings[key]} aria-label={`${title} 알림`} disabled={saving} onClick={() => toggle(key)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${settings[key] ? "bg-[#173f31]" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${settings[key] ? "left-6" : "left-1"}`}/></button></div>)}</div>}
    </section>
    {notice && <p className="mt-4 text-sm font-semibold text-slate-600" aria-live="polite">{notice}</p>}
  </div>;
}
