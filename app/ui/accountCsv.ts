export type CsvPosition = {
  code: string;
  name: string;
  market?: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  purchaseAmount: number;
  evaluationAmount: number;
  profitLoss: number;
  returnRate: number;
};

const headers = ["종목코드", "종목명", "시장", "보유수량", "평균단가", "현재가", "매입금액", "평가금액", "평가손익", "수익률(%)", "통화"];

function csvCell(value: string | number) {
  const text = typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function createAccountCsv(positions: CsvPosition[], currency: "KRW" | "USD") {
  const rows = positions.map((position) => [
    position.code,
    position.name,
    position.market ?? "",
    position.quantity,
    position.averagePrice,
    position.currentPrice,
    position.purchaseAmount,
    position.evaluationAmount,
    position.profitLoss,
    position.returnRate,
    currency,
  ]);

  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function accountCsvFilename(environment: string, fetchedAt: string) {
  const timestamp = new Date(fetchedAt).toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `account-positions-${environment}-${timestamp}.csv`;
}
