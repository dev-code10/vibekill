# 검증 기록

`2026-10-13` 디렉터리는 첨부된 검증 코드를 실제 MORU 앱에 실행한 결과다. HTTP 상태 코드와 JSON 응답은 실행기가 기록했으며, `checks`에는 비교한 기대값과 실제값이 들어 있다.

| 기록 | 내용 |
| --- | --- |
| [summary.txt](2026-10-13/summary.txt) | 전체 요청 순서와 판정 요약 |
| [environment.json](2026-10-13/environment.json) | 실행 시각, 버전, 파일 해시, 정리 결과 |
| [source-comparison.json](2026-10-13/source-comparison.json) | 로컬 앱과 GitHub 커밋의 파일별 비교 |
| [setup.json](2026-10-13/setup.json) | 임시 관리자 로그인과 역할 확인 |
| [password-truncation.json](2026-10-13/password-truncation.json) | 72바이트 뒤만 다른 비밀번호로 인증 |
| [session-reactivation.json](2026-10-13/session-reactivation.json) | 정지 중 요청 여부에 따른 세션 처리 차이 |
| [notice-authorization.json](2026-10-13/notice-authorization.json) | 공지 유지 요청 거부와 자유 카테고리 변경 허용 |
| [package-lock.json](2026-10-13/package-lock.json) | 실행 당시 설치한 패키지 버전과 무결성 정보 |

각 항목의 `requests`는 기록된 순서대로 읽으면 된다. `requestBody`와 `responseBody`에 본문을 남기되 비밀번호는 가렸다. 원본 쿠키, DB 비밀번호, 세션 서명 키는 포함하지 않았다. 보고서의 사용자 ID와 게시글 ID는 이 실행의 값이다.

`source-comparison.json`은 GitHub 커밋의 Git 객체와 로컬 원본을 비교해 별도로 작성한 자료다. GitHub에 있는 앱 파일 10개를 비교했고, 로컬에만 있던 `.gitignore`는 비교 대상에서 제외했다. 나머지 JSON과 `summary.txt`는 `poc/run.mjs`가 생성했다. 잠금 파일은 실행에 사용한 앱 복사본에서 가져왔다.

새 실행은 별도의 `run-...` 디렉터리에 저장된다. 날짜가 붙은 첨부 기록은 보존하고, 다시 검증한 결과는 새 디렉터리에서 확인한다.
