import { NextResponse } from "next/server";
import { getTelegramSettings, saveTelegramSettings, telegramConfigured, type TelegramNotificationSettings } from "../../../telegram.server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: telegramConfigured(), settings: await getTelegramSettings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: Partial<TelegramNotificationSettings>;
  try { body = await request.json() as Partial<TelegramNotificationSettings>; }
  catch { return NextResponse.json({ message: "올바른 설정 요청이 아닙니다." }, { status: 400 }); }
  if ([body.login, body.buyFilled, body.sellFilled].some((value) => typeof value !== "boolean")) {
    return NextResponse.json({ message: "모든 알림 설정은 켜짐 또는 꺼짐이어야 합니다." }, { status: 400 });
  }
  const settings = body as TelegramNotificationSettings;
  await saveTelegramSettings(settings);
  return NextResponse.json({ configured: telegramConfigured(), settings }, { headers: { "Cache-Control": "no-store" } });
}
