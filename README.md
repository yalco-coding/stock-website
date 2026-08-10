# Kiwoom Ledger

키움 REST API의 국내·해외 모의투자 계좌를 확인하는 개인 투자 대시보드입니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

Windows ARM에서는 Cloudflare `workerd`가 지원되지 않으므로 화면 개발 시 다음 설정을 사용할 수 있습니다.

```bash
npx vite --config vite.local.config.ts
```

## 환경변수

루트 `.env`에 다음 서버 전용 변수를 설정합니다. 값이나 접근 토큰은 클라이언트 번들로 전달되지 않습니다.

- `KRA_REAL_APP_KEY`
- `KRA_REAL_APP_SECRET`
- `KRA_MOCK_DOMESTIC_APP_KEY`
- `KRA_MOCK_DOMESTIC_APP_SECRET`
- `KRA_MOCK_OVERSEAS_APP_KEY`
- `KRA_MOCK_OVERSEAS_APP_SECRET`

현재 UI는 안전을 위해 실투자 환경을 비활성화하며, 계좌 조회는 모의투자 도메인만 사용합니다.
