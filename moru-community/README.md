# MORU Community

Node.js + Express + MySQL 기반의 한국어 커뮤니티 웹 애플리케이션입니다. 반응형 UI, 세션 로그인, 회원가입, 프로필 편집, 게시글/댓글, 관리자 센터를 포함합니다.

## 구현 기능

- 이메일 회원가입 및 로그인/로그아웃 (bcrypt 비밀번호 해시, 세션 ID 재발급)
- 프로필 닉네임, 소개, 프로필 이미지 URL 수정
- 게시글 생성/조회/수정/삭제, 게시판 카테고리, 검색, 최신순/조회순 정렬, 페이지네이션
- 댓글 작성 및 작성자/관리자의 댓글 삭제
- 관리자 센터: 회원/게시글/댓글 현황 요약, 회원 권한 변경, 계정 활성화/비활성화, 회원 삭제, 게시글 삭제
- 서버 측 권한 검사, SQL 파라미터 바인딩, 로그인 엔드포인트 요청 제한, Helmet 보안 헤더
- 데스크톱/모바일 반응형 레이아웃과 키보드 조작 지원

## 빠른 실행: Docker Compose 권장

Docker와 Docker Compose가 설치되어 있다면 프로젝트 디렉터리에서 다음을 실행합니다.

```bash
docker compose up --build -d
```

브라우저에서 <http://localhost:3000> 을 엽니다. MySQL 데이터와 세션은 Docker 볼륨에 저장됩니다. `sql/schema.sql`은 **MySQL 데이터 볼륨이 처음 생성될 때만** 자동 실행됩니다.

관리자 계정은 아래 명령으로 생성합니다. 예시 이메일/비밀번호 대신 직접 정한 값을 사용하세요.

```bash
docker compose exec app npm run admin:create -- admin@example.com "강력한비밀번호123!" "모루 관리자"
```

관리자 센터: <http://localhost:3000/admin>

로컬 개발용 기본 Docker 비밀번호는 배포용이 아닙니다. 공개 서버에서 사용하기 전에 `MYSQL_ROOT_PASSWORD`와 32자 이상의 무작위 `SESSION_SECRET` 환경변수를 변경하고, MySQL root 대신 최소 권한의 전용 DB 계정을 사용하세요. 이미 볼륨이 초기화된 상태에서 스키마를 다시 실행해야 한다면 데이터를 백업한 뒤 진행하세요.

## 수동 실행

요구 사항: Node.js 20 이상, MySQL 8 이상.

1. MySQL에서 `sql/schema.sql`을 실행합니다. 예: `mysql -u root -p < sql/schema.sql`
2. 로컬 MySQL에서 애플리케이션 계정을 만듭니다(비밀번호는 `.env` 값과 일치시켜 주세요). MySQL 관리자로 다음 SQL을 실행합니다.

   ```sql
   CREATE USER IF NOT EXISTS 'community_user'@'127.0.0.1' IDENTIFIED BY 'change-this-password';
   GRANT ALL PRIVILEGES ON moru_community.* TO 'community_user'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```

3. `.env.example`을 `.env`로 복사한 뒤 DB 접속 정보와 `SESSION_SECRET`을 설정합니다. 원격 DB를 사용한다면 DB 계정의 host 권한과 `DB_HOST`도 해당 환경에 맞게 조정하세요.
4. 의존성을 설치하고 서버를 실행합니다.

```bash
npm install
npm run dev
```

운영 모드에서는 `npm start`를 사용합니다. `.env`의 `DB_NAME`은 스키마를 생성한 데이터베이스 이름과 일치해야 합니다. `express-mysql-session`이 처음 실행될 때 세션 저장 테이블을 생성하므로 해당 DB에 테이블 생성/변경 권한이 필요합니다.

관리자 계정 만들기:

```bash
npm run admin:create -- admin@example.com "강력한비밀번호123!" "모루 관리자"
```

같은 이메일이 이미 있으면 이 명령은 해당 계정을 관리자 역할로 변경하고 비밀번호/닉네임을 갱신합니다. 명령 인수의 비밀번호는 셸 히스토리에 남을 수 있으므로 안전한 관리자 환경에서 실행하고, 사용 후에는 반드시 비밀번호를 관리하세요.

## 주요 경로

- `/` — 커뮤니티 홈 피드
- `/admin` — 관리자 센터 (관리자 로그인 필요)
- `/api/health` — 서버 상태 확인
- `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` — 인증
- `/api/me` — 내 프로필 조회/수정
- `/api/posts` — 게시글 목록/작성
- `/api/posts/:id` — 게시글 조회/수정/삭제
- `/api/posts/:id/comments` — 댓글 작성
- `/api/admin/*` — 관리자 API

## 데이터와 보안 메모

- 게시글/댓글 본문은 클라이언트에서 `textContent`로 출력하여 HTML로 실행하지 않습니다.
- 모든 DB 입력은 파라미터 바인딩을 사용하며, 사용자/관리자 권한은 서버에서 검사합니다.
- 세션 쿠키는 `HttpOnly`, `SameSite=Lax`이며 운영 환경에서 `Secure` 옵션을 적용합니다. HTTPS 역방향 프록시 뒤에서 운영할 경우 `NODE_ENV=production`을 유지하세요.
- 이 프로젝트는 완성 가능한 기본 커뮤니티 스타터입니다. 실제 공개 서비스 전에는 개인정보 처리방침/이용약관, 이메일 인증·비밀번호 재설정, 백업/복구, 로그 모니터링, 배포 환경의 별도 CSRF 방어 및 보안 점검을 추가로 마련하세요.
