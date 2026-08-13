import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loggedFetch as fetch } from "./external-api-logger.server";

export type TelegramNotificationType = "login" | "buyFilled" | "sellFilled";
export type TelegramNotificationSettings = Record<TelegramNotificationType, boolean>;

const defaults: TelegramNotificationSettings = { login: true, buyFilled: true, sellFilled: true };
const dataDirectory = path.join(process.cwd(), ".data");
const settingsPath = path.join(dataDirectory, "telegram-notification-settings.json");
const sentEventsPath = path.join(dataDirectory, "telegram-sent-events.json");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(filePath, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    console.error("Telegram 데이터 파일을 읽지 못했습니다.", error);
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function getTelegramSettings(): Promise<TelegramNotificationSettings> {
  const stored = await readJson<Partial<TelegramNotificationSettings>>(settingsPath, {});
  return { login: stored.login ?? defaults.login, buyFilled: stored.buyFilled ?? defaults.buyFilled, sellFilled: stored.sellFilled ?? defaults.sellFilled };
}

export async function saveTelegramSettings(settings: TelegramNotificationSettings): Promise<void> {
  await writeJson(settingsPath, settings);
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegramNotification(type: TelegramNotificationType, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !(await getTelegramSettings())[type]) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }), cache: "no-store",
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || result.ok !== true) throw new Error(result.description || `Telegram API 응답: ${response.status}`);
    return true;
  } catch (error) {
    console.error("Telegram 알림 전송에 실패했습니다.", error);
    return false;
  }
}

export async function sendTelegramNotificationOnce(eventId: string, type: TelegramNotificationType, text: string): Promise<boolean> {
  const sent = await readJson<Record<string, number>>(sentEventsPath, {});
  if (sent[eventId]) return false;
  if (!(await sendTelegramNotification(type, text))) return false;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = Object.fromEntries(Object.entries(sent).filter(([, timestamp]) => timestamp >= cutoff));
  recent[eventId] = Date.now();
  await writeJson(sentEventsPath, recent);
  return true;
}
