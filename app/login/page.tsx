import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "로그인 | Kiwoom Ledger", robots: { index: false, follow: false } };

export default function LoginPage() {
  return <main className="login-shell"><Suspense><LoginForm /></Suspense></main>;
}
