# MORU 커뮤니티 취약점 분석

VibeKill README에 소개한 세 가지 문제를 MORU 커뮤니티에서 재현했다. 비밀번호 검증 범위, 계정 정지 시 세션 처리, 공지 게시글 수정 권한을 각각 확인했다.

| 항목                            | 확인한 결과                                                                   | 상세 보고서                               |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| 비밀번호 72바이트 절단          | 첫 72바이트가 같고 마지막 문자가 다른 비밀번호로 같은 계정에 로그인됐다.      | [비밀번호 검증](password-truncation.md)   |
| 계정 정지 해제 후 세션 재사용   | 정지 중 사용하지 않은 세션이 정지 해제 후 재로그인 없이 인증됐다.             | [세션 처리](session-reactivation.md)      |
| 공지 게시글 수정 권한 검증 누락 | 일반 작성자가 자신의 공지 글을 자유 게시글로 바꾸면서 제목과 본문을 수정했다. | [공지 수정 권한](notice-authorization.md) |

## 검증 환경

2026년 10월 13일 15시 52분 KST에 로컬 HTTP 요청으로 검증했다. 대상은 [커밋 9fda842](https://github.com/dev-code10/vibekill/tree/9fda842dda38a933034159e539ea7544c67615ac)의 앱 코드다. 로컬 원본과 GitHub의 앱 파일은 개행 차이를 제외하면 일치한다. 파일별 비교 결과는 [source-comparison.json](evidence/2026-10-13/source-comparison.json)에 있다.

| 구성                  | 사용한 버전 또는 설정                                     |
| --------------------- | --------------------------------------------------------- |
| Node.js               | 22.19.0                                                   |
| MySQL                 | 8.0.45                                                    |
| Express               | 4.22.3                                                    |
| bcryptjs              | 2.4.3                                                     |
| express-session       | 1.19.0                                                    |
| express-mysql-session | 3.0.3                                                     |
| 실행 모드             | development                                               |
| 데이터                | 빈 DB에 만든 검증용 관리자 1개, 일반 계정 4개, 게시글 1개 |

원본 앱의 복사본에 의존성을 설치하고 별도 MySQL 프로세스를 실행했다. 기존 MySQL 서비스와 데이터는 사용하지 않았다. 관리자 계정만 초기 준비 과정에서 SQL로 만들었으며, 일반 계정 생성과 취약점 재현은 앱 API로 진행했다. 실제 세션 저장소는 MySQL이며 모의 응답이나 대체 인증 로직은 사용하지 않았다.

검증 전후 앱 파일의 SHA-256은 같았다. 실행한 앱과 MySQL을 종료하고 임시 데이터 디렉터리를 정리했다. 실행 환경, 파일 해시와 정리 결과는 [environment.json](evidence/2026-10-13/environment.json)에 기록했다.

## 자료 구성

```text
report/
├── README.md
├── password-truncation.md
├── session-reactivation.md
├── notice-authorization.md
├── reproduce.md
├── poc/
│   ├── run.mjs
│   ├── http.mjs
│   ├── password-truncation.mjs
│   ├── session-reactivation.mjs
│   └── notice-authorization.mjs
└── evidence/
    ├── README.md
    └── 2026-10-13/
        ├── environment.json
        ├── source-comparison.json
        ├── setup.json
        ├── password-truncation.json
        ├── session-reactivation.json
        ├── notice-authorization.json
        ├── package-lock.json
        └── summary.txt
```

재현 절차는 [reproduce.md](reproduce.md), 요청 순서와 판정 결과는 [summary.txt](evidence/2026-10-13/summary.txt)에서 확인할 수 있다. JSON에는 요청 본문과 응답을 남기고 비밀번호는 가렸다. 세션 쿠키 값은 저장하지 않았다.

## 결과를 해석할 때

비밀번호 문제는 72바이트 뒤의 차이가 무시되는 현상이다. 비밀번호 앞부분을 모르는 상태에서 임의 계정을 탈취한 결과는 아니다. 세션 문제는 계정이 다시 활성화된 뒤에 발생하며, 정지 상태의 인증 요청은 차단됐다. 공지 수정은 해당 글의 원 작성자에게서 재현됐고, 다른 사용자의 수정 요청은 거부됐다.

이 폴더는 위 세 항목의 분석과 검증 자료만 다룬다. 수정 방향은 각 보고서에 적었으며 연구 대상 앱에는 적용하지 않았다.
