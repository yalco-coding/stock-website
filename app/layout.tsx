import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Kiwoom Ledger",
  description: "차분하고 명확한 개인 투자 계좌 대시보드",
  openGraph: {
    title: "Kiwoom Ledger",
    description: "투자 계좌를 한눈에",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Kiwoom Ledger 투자 계좌 대시보드" }],
  },
  twitter: { card: "summary_large_image", title: "Kiwoom Ledger", description: "투자 계좌를 한눈에", images: ["/og.png"] },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
