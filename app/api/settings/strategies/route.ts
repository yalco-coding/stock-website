import { NextResponse } from "next/server";
import { getStrategySettings, isValidStrategySettingsPatch, patchStrategySettings, StrategySettingsRevisionConflict } from "../../../strategy-settings.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getStrategySettings();
  return NextResponse.json({ settings, revision: settings.revision }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "올바른 전략 설정 요청이 아닙니다." }, { status: 400 });
  }
  if (!isValidStrategySettingsPatch(body)) return NextResponse.json({ message: "전략 설정 변경값을 확인해 주세요." }, { status: 400 });
  try {
    const settings = await patchStrategySettings(body);
    return NextResponse.json({ settings, revision: settings.revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StrategySettingsRevisionConflict) {
      return NextResponse.json({ message: error.message, settings: error.settings, revision: error.settings.revision }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : "전략 설정을 저장하지 못했습니다." }, { status: 400 });
  }
}
