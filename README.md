# Kiwoom Ledger

키움 REST API로 국내·해외 실투자 및 모의투자 계좌와 시세를 조회하고, 모의투자 주문을 연습하는 개인용 대시보드입니다. 실투자 매수·매도는 지원하지 않습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm run dev
```

루트의 `.env.example`을 `.env`로 복사한 뒤 키움 REST API 인증정보를 입력합니다. `.env`의 값은 서버에서만 사용하며 저장소에 커밋하지 않습니다.

## 배포

AWS Lightsail Ubuntu 인스턴스에 배포하는 전체 절차는 [LIGHTSAIL_DEPLOYMENT.md](./LIGHTSAIL_DEPLOYMENT.md)를 참고하세요. 이 프로젝트는 OpenAI Sites 배포 설정을 더 이상 사용하지 않습니다.
