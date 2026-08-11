"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.get("password"), next: searchParams.get("next") }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const result = contentType.includes("application/json")
        ? await response.json() as { message?: string; redirectTo?: string }
        : { message: response.ok ? undefined : "서버가 로그인 요청을 처리하지 못했습니다." };
      if (!response.ok || !result.redirectTo) throw new Error(result.message || "로그인하지 못했습니다.");
      window.location.assign(result.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-mark" aria-hidden="true">K</div>
      <p className="login-eyebrow">KIWOOM LEDGER</p>
      <h1>로그인</h1>
      <p className="login-copy">대시보드와 투자 API를 사용하려면 비밀번호를 입력하세요.</p>
      <label htmlFor="password">비밀번호</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>{submitting ? "확인 중…" : "로그인"}</button>
    </form>
  );
}
