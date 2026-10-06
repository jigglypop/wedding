# 우리의 웨딩 노트

신랑·신부가 함께 쓰는 결혼 준비 노트입니다. 할 일, 예산·지급액, 업체 비교, 하객·RSVP·좌석, 본식 타임라인, 메모, 자료 보관함을 관리하고, GPT 기반 AI 웨딩플래너가 현재 계획과 자료를 읽고 상담합니다. AI의 데이터 변경 제안은 화면에서 **반영하기**를 눌러야 저장됩니다.

서비스 주소: <https://ourweddingnote.com>

## 계정과 함께 쓰기

- **회원가입**: 아이디·비밀번호·이름과 신랑/신부를 입력해 가입을 신청합니다. 관리자가 **회원 관리**에서 승인하면 로그인할 수 있습니다.
- **관리자**: `.env`의 `WEDDING_ADMIN_USERNAME`/`WEDDING_ADMIN_PASSWORD`로 첫 로그인 때 자동 생성됩니다. 가입 승인·이용 중지·임시 비밀번호 발급·삭제를 할 수 있습니다. 이 값을 바꿔 재배포하면 관리자 비밀번호가 그 값으로 다시 설정됩니다.
- **신부(신랑) 초대**: 설정 → 함께하는 사람에서 초대 링크를 만들어 카카오톡 등으로 보냅니다. 링크로 가입하면 승인 없이 바로 같은 노트를 함께 씁니다. 링크는 7일 동안 한 번만 쓸 수 있고, 노트당 두 사람까지 함께합니다. 함께 쓰는 동안 상대의 변경은 30초 안에 화면에 반영됩니다.
- 세션은 30일 유지되는 HttpOnly·Secure 쿠키이며, 비밀번호 변경·이용 중지 시 다른 기기의 세션이 끊깁니다.

## 실행

```powershell
npm install
npm run dev
```

웹은 `http://127.0.0.1:5173`, API는 `http://127.0.0.1:8787`입니다. 로컬 데이터는 `.local/db.json`에 저장되고, 관리자는 `.env`의 `WEDDING_ADMIN_*` 값(없으면 `.local/dev-access.json`)으로 로그인합니다.

```powershell
npm test                 # 모델·계정·초대 흐름 테스트
npm run build
npm run verify           # 실행 중인 로컬 API 종단 검증
npm run verify -- --live # 배포된 사이트 검증 (--ai 를 붙이면 AI 상담까지)
```

## 배포

- **자동 배포**: `main` 브랜치에 푸시하면 GitHub Actions가 테스트·빌드 후 Lambda와 웹사이트를 배포합니다(`.github/workflows/deploy.yml`). AWS 접근은 OIDC로 받는 최소 권한 역할(`infra/github-deploy-role.yaml`)을 쓰며, GitHub에 비밀값을 저장하지 않습니다.
- **인프라·비밀값 변경**: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1` — CloudFormation 스택(`infra/template.yaml`), 도메인·인증서, 관리자 계정, OpenAI 키, 비공개 자료를 반영합니다.
- 구성: CloudFront(HTTPS, `www` → 루트 도메인 리디렉션) · 비공개 S3 웹/자료 버킷 · Node.js Lambda API · DynamoDB(시점 복구) · Route 53. 인증서는 us-east-1 ACM에 있습니다.
- 배포 결과와 접속 요약은 `.deployment/`에 저장되며 공유하지 마세요. `runtime-secrets.json`은 재배포 때 세션 키를 유지합니다.

## 카카오톡 미리보기

`public/og-image.png`(1200×630)가 링크 썸네일입니다. 초대 링크(`/invite/...`)는 초대한 사람의 이름이 들어간 미리보기 문구를 보여 줍니다. 디자인을 바꾸려면 `scripts/brand/og-image.html`을 수정하고 `scripts/brand/render.ps1`로 다시 렌더링하세요. 카카오톡은 미리보기를 캐시하므로, 바꾼 뒤에는 카카오 개발자 사이트의 공유 디버거에서 캐시를 지워 주세요.

## 자료와 저작권

`data/`의 노션 가이드·체크리스트·엑셀은 원작자의 재배포 제한이 있어 이 저장소에 포함하지 않습니다. 로컬에만 두고, `scripts/deploy.ps1`이 비공개 S3 버킷에 올려 배포 빌드에 사용합니다. 이 자료는 관리자 노트(커플 본인)에서만 보이며, 다른 가입자에게는 직접 작성한 기본 체크리스트(`server/starter.ts`)와 각자 올린 자료만 제공됩니다. 템플릿의 참고 견적은 실제 지출로 입력하지 않았습니다.

이미지 자료는 `python scripts/make-thumbnails.py`로 만든 WebP 미리보기를 목록에 사용합니다.

## 제한

AI 상담은 노트당 분당 6회·하루 30회(관리자 노트 100회), 서비스 전체 하루 300회입니다. 자료는 파일당 3MB, 노트당 하루 50개·최대 200개입니다. 로그인은 IP·아이디별로 15분에 각각 20회·10회까지 시도할 수 있습니다. AWS와 OpenAI 사용량에 따라 비용이 발생합니다.
