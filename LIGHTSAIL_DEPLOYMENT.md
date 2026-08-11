# AWS Lightsail 배포 가이드

이 문서는 Docker 없이 AWS Lightsail의 Ubuntu 인스턴스 한 대에 Kiwoom Ledger를 배포하는 절차입니다. 앱은 Node.js로 실행하고, Ubuntu의 `systemd`가 앱을 항상 켜 둡니다. Nginx가 외부 요청을 앱으로 전달하며 Certbot이 무료 HTTPS 인증서를 설정합니다.

## 준비물

- AWS 계정
- 사용할 도메인
- 이 저장소에 접근할 수 있는 Git 주소
- 키움 REST API 모의투자 앱 키와 시크릿

> 이 앱은 개인용 투자 대시보드입니다. 인터넷에 공개하기 전에 별도의 로그인 또는 IP 접근 제한을 추가하는 것을 권장합니다. 현재 UI의 실투자 기능은 비활성화되어 있지만 키움 인증정보는 반드시 서버의 `.env`에만 보관하세요.

## 1. Lightsail 인스턴스 만들기

1. [AWS Lightsail 콘솔](https://lightsail.aws.amazon.com/)에서 **인스턴스 생성**을 선택합니다.
2. 리전은 주 사용 위치와 가까운 곳(예: 서울)을 선택합니다.
3. 플랫폼은 **Linux/Unix**, 블루프린트는 **OS 전용 > Ubuntu 24.04 LTS**를 선택합니다.
4. 요금제는 먼저 1GB 이상 메모리로 시작합니다. 빌드 중 메모리 부족이 발생하면 더 큰 요금제로 올립니다.
5. 인스턴스를 만든 뒤 **네트워킹 > 고정 IP 생성**에서 고정 IP를 연결합니다. 일반 공인 IP는 인스턴스를 중지했다 시작하면 바뀔 수 있습니다.
6. 인스턴스의 **네트워킹 > IPv4 방화벽**에 다음 규칙만 둡니다.
   - SSH / TCP 22: 가능하면 내 IP 주소만 허용
   - HTTP / TCP 80: 모든 주소
   - HTTPS / TCP 443: 모든 주소

앱 포트 3000은 Lightsail 방화벽에 열지 않습니다.

## 2. 도메인 연결하기

도메인을 관리하는 DNS 서비스에서 다음 레코드를 만듭니다.

| 종류 | 이름 | 값 |
|---|---|---|
| A | 사용할 호스트명 (`@` 또는 `stocks`) | Lightsail 고정 IP |

예를 들어 `stocks.example.com`을 사용한다면 `stocks` A 레코드를 고정 IP로 지정합니다. DNS 반영에는 시간이 걸릴 수 있습니다. 아래 명령에서 `stocks.example.com`은 실제 도메인으로 바꾸세요.

## 3. 서버 접속 및 필수 프로그램 설치

Lightsail 콘솔의 **SSH를 사용하여 연결** 버튼으로 터미널을 엽니다. 다음 명령을 차례대로 실행합니다.

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

`node --version` 결과가 `v22.13.0` 이상인지 확인합니다.

## 4. 프로젝트 내려받기

아래의 Git 주소는 실제 저장소 주소로 바꿉니다.

```bash
cd /home/ubuntu
git clone YOUR_GIT_REPOSITORY_URL stock-website
cd stock-website
npm ci
```

비공개 저장소라면 GitHub 배포 키 또는 개인 액세스 토큰을 먼저 설정해야 합니다. 압축 파일로 전달하는 경우에도 최종 프로젝트 경로가 `/home/ubuntu/stock-website`가 되도록 압축을 풉니다.

## 5. 서버 환경변수 입력하기

예제 파일을 복사하고 편집합니다.

```bash
cp .env.example .env
nano .env
```

`SITE_URL`에는 `https://`를 포함한 실제 주소를 입력하고, 사용하는 모의투자 환경의 키와 시크릿을 입력합니다. 저장은 `Ctrl+O`, Enter, 종료는 `Ctrl+X`입니다.

```dotenv
SITE_URL=https://stocks.example.com
KRA_MOCK_DOMESTIC_APP_KEY=발급받은_키
KRA_MOCK_DOMESTIC_APP_SECRET=발급받은_시크릿
KRA_MOCK_OVERSEAS_APP_KEY=발급받은_키
KRA_MOCK_OVERSEAS_APP_SECRET=발급받은_시크릿
```

파일을 현재 사용자만 읽을 수 있게 제한하고 앱을 빌드합니다.

```bash
chmod 600 .env
npm run build
```

## 6. 앱을 서비스로 등록하기

저장소에 포함된 서비스 파일을 설치합니다.

```bash
sudo cp deploy/kiwoom-ledger.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiwoom-ledger
sudo systemctl status kiwoom-ledger --no-pager
```

상태가 `active (running)`이면 정상입니다. 문제가 있으면 다음 명령으로 로그를 봅니다.

```bash
sudo journalctl -u kiwoom-ledger -n 100 --no-pager
```

## 7. Nginx와 HTTPS 설정하기

먼저 설정 템플릿의 `YOUR_DOMAIN`을 실제 도메인으로 바꿔 설치합니다.

```bash
sed 's/YOUR_DOMAIN/stocks.example.com/g' deploy/nginx.conf | sudo tee /etc/nginx/sites-available/kiwoom-ledger >/dev/null
sudo ln -s /etc/nginx/sites-available/kiwoom-ledger /etc/nginx/sites-enabled/kiwoom-ledger
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

브라우저에서 `http://stocks.example.com`이 열리는지 확인한 다음 HTTPS를 설정합니다.

```bash
sudo certbot --nginx -d stocks.example.com
sudo certbot renew --dry-run
```

Certbot 질문에 이메일 주소와 HTTP를 HTTPS로 전환하는 옵션을 입력합니다. 완료 후 `https://stocks.example.com`으로 접속해 확인합니다. 인증서는 systemd 타이머가 자동 갱신합니다.

## 8. 새 버전 배포하기

코드가 변경될 때마다 SSH로 접속해 다음 명령을 실행합니다.

```bash
cd /home/ubuntu/stock-website
git pull --ff-only
npm ci
npm run build
sudo systemctl restart kiwoom-ledger
sudo systemctl status kiwoom-ledger --no-pager
```

빌드가 실패하면 서비스 재시작을 하지 마세요. 기존 프로세스는 계속 이전 빌드를 제공합니다.

## 운영 점검 명령

```bash
# 앱 로그
sudo journalctl -u kiwoom-ledger -f

# 앱과 웹 서버 상태
sudo systemctl status kiwoom-ledger nginx --no-pager

# 서버 내부에서 앱 확인
curl -I http://127.0.0.1:3000

# HTTPS 인증서 갱신 상태
systemctl list-timers | grep certbot
```

정기적으로 Lightsail 스냅샷을 생성하고 Ubuntu 보안 업데이트를 적용하세요. `.env`는 Git에 올리거나 화면 캡처·로그에 노출하지 않습니다.

## 참고 문서

- [Lightsail 고정 IP 생성 및 연결](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
- [Lightsail 인스턴스 방화벽](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
- [Lightsail DNS 이해하기](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-dns-in-amazon-lightsail.html)
- [Certbot Nginx 안내](https://certbot.eff.org/instructions?ws=nginx&os=snap)
