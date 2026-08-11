import type { Metadata } from "next";
import { Dashboard } from "./ui/Dashboard";

export const metadata: Metadata = {
  title: "잔고 | Kiwoom Ledger",
  description: "국내·해외 실투자 및 모의투자 계좌를 한눈에 확인하는 개인 투자 관리 도구",
};

export default function Home() {
  return <Dashboard />;
}
