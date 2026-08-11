# AWS Lightsail 배포 가이드

이 문서는 별도 도메인 없이 AWS Lightsail의 Ubuntu 인스턴스 한 대에 Kiwoom Ledger를 배포하는 절차입니다. 앱은 Node.js로 실행하고, Ubuntu의 `systemd`가 앱을 항상 켜 둡니다. Nginx가 Lightsail 고정 IP로 들어온 요청을 앱으로 전달합니다.

## 준비물

- AWS 계정
- 이 저장소에 접근할 수 있는 Git 주소
- 사용할 환경의 키움 REST API 앱 키와 시크릿

> 이 앱은 개인용 투자 대시보드이며 실투자 계좌 정보도 조회할 수 있습니다. 도메인 없이 이 절차를 따르면 `http://고정_IP`로 접속하므로 브라우저와 서버 사이의 통신이 암호화되지 않습니다. Lightsail 방화벽의 HTTP 접근을 본인의 공인 IP로 제한하고, 공용 인터넷 전체에 공개하지 마세요. 키움 인증정보는 반드시 서버의 `.env`에만 보관합니다.

## 1. Lightsail 인스턴스 만들기

1. [AWS Lightsail 콘솔](https://lightsail.aws.amazon.com/)에서 **인스턴스 생성**을 선택합니다.
2. 리전은 주 사용 위치와 가까운 곳(예: 서울)을 선택합니다.
3. 플랫폼은 **Linux/Unix**, 블루프린트는 **OS 전용 > Ubuntu 24.04 LTS**를 선택합니다.
4. 요금제는 먼저 1GB 이상 메모리로 시작합니다. 빌드 중 메모리 부족이 발생하면 더 큰 요금제로 올립니다.
5. 인스턴스를 만든 뒤 **네트워킹 > 고정 IP 생성**에서 고정 IP를 연결합니다. 일반 공인 IP는 인스턴스를 중지했다 시작하면 바뀔 수 있습니다.
6. 인스턴스의 **네트워킹 > IPv4 방화벽**에 다음 규칙만 둡니다.
   - SSH / TCP 22: 가능하면 내 IP 주소만 허용
   - HTTP / TCP 80: 내 공인 IP 주소만 허용

앱 포트 3000은 Lightsail 방화벽에 열지 않습니다.

현재 공인 IP는 로컬 PC에서 다음과 같이 확인할 수 있습니다.

```bash
curl https://checkip.amazonaws.com
```

접속 장소가 바뀌거나 인터넷 회선의 공인 IP가 변경되면 Lightsail 방화벽의 허용 IP도 갱신해야 합니다.

## 2. 서버 접속 및 필수 프로그램 설치

Lightsail 콘솔의 **SSH를 사용하여 연결** 버튼으로 터미널을 엽니다. 다음 명령을 차례대로 실행합니다.

```bash
sudo apt update
sudo apt install -y git nginx ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

`node --version` 결과가 `v22.13.0` 이상인지 확인합니다.

## 3. 프로젝트 내려받기

아래의 Git 주소는 실제 저장소 주소로 바꿉니다.

```bash
cd /home/ubuntu
git clone YOUR_GIT_REPOSITORY_URL stock-website
cd stock-website
npm ci
```

비공개 저장소라면 GitHub 배포 키 또는 개인 액세스 토큰을 먼저 설정해야 합니다. 압축 파일로 전달하는 경우에도 최종 프로젝트 경로가 `/home/ubuntu/stock-website`가 되도록 압축을 풉니다.

## 4. 서버 환경변수 입력하기

예제 파일을 복사하고 편집합니다.

```bash
cp .env.example .env
nano .env
```

`SITE_URL`에는 `http://`와 Lightsail 고정 IP를 입력하고, 사용하는 투자 환경의 키와 시크릿을 입력합니다. 실투자 조회를 사용하지 않으면 `KRA_REAL_*` 값은 비워 둬도 됩니다. 저장은 `Ctrl+O`, Enter, 종료는 `Ctrl+X`입니다.

```dotenv
SITE_URL=http://203.0.113.10
KRA_REAL_APP_KEY=발급받은_실전_키
KRA_REAL_APP_SECRET=발급받은_실전_시크릿
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

위의 `203.0.113.10`은 예시 주소이므로 본인의 Lightsail 고정 IP로 바꿉니다.

## 5. 앱을 서비스로 등록하기

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

## 6. Nginx 설정 및 고정 IP로 접속하기

도메인 대신 모든 호스트 이름을 받도록 설정 템플릿의 `YOUR_DOMAIN`을 `_`로 바꿔 설치합니다.

```bash
sed 's/YOUR_DOMAIN/_/g' deploy/nginx.conf | sudo tee /etc/nginx/sites-available/kiwoom-ledger >/dev/null
sudo ln -s /etc/nginx/sites-available/kiwoom-ledger /etc/nginx/sites-enabled/kiwoom-ledger
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

로컬 PC의 브라우저에서 `http://LIGHTSAIL_고정_IP`로 접속해 앱이 열리는지 확인합니다. 예를 들어 고정 IP가 `203.0.113.10`이면 `http://203.0.113.10`으로 접속합니다.

> 이 구성은 HTTP만 사용합니다. Lightsail 방화벽에서 TCP 80을 모든 주소(`0.0.0.0/0`)에 허용하면 계좌 화면이 공개될 수 있으므로 반드시 본인의 공인 IP만 허용하세요. 여러 장소에서 안전하게 접속해야 한다면 도메인과 HTTPS를 설정하거나 VPN을 추가하는 방식을 권장합니다.

## 7. 새 버전 배포하기

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

# 실제 외부 주소 확인
curl -I http://LIGHTSAIL_고정_IP
```

정기적으로 Lightsail 스냅샷을 생성하고 Ubuntu 보안 업데이트를 적용하세요. `.env`는 Git에 올리거나 화면 캡처·로그에 노출하지 않습니다.

## 참고 문서

- [Lightsail 고정 IP 생성 및 연결](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
- [Lightsail 인스턴스 방화벽](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
