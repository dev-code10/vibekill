# 재현 방법

`poc/run.mjs`가 빈 데이터 디렉터리에 MySQL을 실행하고 MORU 앱을 띄운 뒤 세 가지 검증을 순서대로 수행한다. 관리자 비밀번호나 기존 DB 접속 정보를 입력할 필요는 없다. 대상 URL을 받는 기능도 없으며, 직접 띄운 앱으로만 요청을 보낸다.

## 준비

Node.js 22와 MySQL Server 8.0이 필요하다. 첨부 결과는 Node.js 22.19.0, MySQL 8.0.45, Windows에서 확인했다. MySQL 클라이언트인 `mysql`뿐 아니라 서버 실행 파일인 `mysqld`가 설치돼 있어야 한다.

저장소에서 `report`와 `moru-community`는 같은 위치에 둔다.

```text
vibekill/
├── moru-community/
└── report/
```

아래 명령은 이 두 폴더가 있는 저장소 루트에서 PowerShell로 실행한다. 원본 앱 대신 `report/.work/app`에 복사본을 만들고, 첨부한 잠금 파일로 검증 당시 의존성을 설치한다. 복사 대상 디렉터리는 새로 생성하므로 이미 같은 이름이 있으면 다른 이름을 사용한다.

```powershell
New-Item -ItemType Directory -Force -Path .\report\.work | Out-Null
New-Item -ItemType Directory -Path .\report\.work\app -ErrorAction Stop | Out-Null
Copy-Item .\moru-community\server.js, .\moru-community\package.json .\report\.work\app\
Copy-Item .\moru-community\public, .\moru-community\sql, .\moru-community\scripts .\report\.work\app\ -Recurse
Copy-Item .\report\evidence\2026-10-13\package-lock.json .\report\.work\app\package-lock.json
Push-Location .\report\.work\app
npm.cmd ci --ignore-scripts --no-audit --no-fund
Pop-Location
```

원본 `.env`는 복사하지 않는다. 실행기는 앱에 사용할 DB 주소, 임시 계정, 세션 키를 새로 설정한다. MySQL을 준비할 때 쓰는 관리자 계정도 새로 만든 임시 인스턴스의 계정이다.

## 전체 실행

`mysqld`가 PATH에 등록돼 있으면 다음과 같이 실행한다.

```powershell
node .\report\poc\run.mjs --app .\report\.work\app
```

PATH에 없다면 실행 파일 경로를 지정한다.

```powershell
node .\report\poc\run.mjs --app .\report\.work\app --mysqld "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"
```

MySQL과 HTTP 포트는 빈 포트에서 선택하므로 기존 3306이나 3000 포트를 비울 필요가 없다. 서버를 따로 실행하거나 원본 DB에 스키마를 넣을 필요도 없다.

## 항목별 실행

세 검증 코드는 각각 별도 파일이며 `--case`로 실행할 항목을 고른다. 아래 명령은 `mysqld`가 PATH에 있는 경우다.

```powershell
node .\report\poc\run.mjs --app .\report\.work\app --case password-truncation
node .\report\poc\run.mjs --app .\report\.work\app --case session-reactivation
node .\report\poc\run.mjs --app .\report\.work\app --case notice-authorization
```

매 실행마다 새 DB와 테스트 계정을 만든다. 세션 검증은 정지 중 B로 요청하지 않는 순서가 핵심이다. B까지 요청하면 그 세션도 폐기되므로 다른 시험이 된다.

## 결과 읽기

결과는 기본적으로 `report/evidence/run-.../`에 저장한다. 직접 위치를 지정하려면 `--out`을 사용한다. 기존 디렉터리는 덮어쓰지 않는다.

```powershell
node .\report\poc\run.mjs --app .\report\.work\app --out .\report\evidence\my-run
```

| 파일 또는 값 | 의미 |
| --- | --- |
| summary.txt | HTTP 요청 순서, 상태 코드, 확인한 값 |
| 각 항목의 JSON | 요청 본문, 응답, 기대값과 실제값 |
| environment.json | 실제 의존성 버전, 실행 전후 파일 해시, 프로세스 및 임시 DB 정리 결과 |
| reproduced | 보고서에 적힌 취약한 동작과 비교 조건이 모두 일치 |
| incomplete | 실행 오류 또는 비교 조건 불일치로 검증 중단 |
| 종료 코드 0 | 선택한 취약점 재현과 정리 완료 |
| 종료 코드 1 | 실행 실패, 관측값 불일치 또는 정리 실패 |

여기서 성공은 취약점이 재현됐다는 뜻이다. 보안 수정이 통과했다는 뜻이 아니다. 수정된 앱에서 조건이 달라지면 스크립트가 중단될 수 있으며, 그 결과만으로 수정이 완전하다고 판정하지 않는다.

증거에는 비밀번호를 `[redacted]`로 남기고 쿠키 값은 기록하지 않는다. 요청에 쿠키를 보냈는지와 응답에서 세션 쿠키를 설정했는지만 기록한다. 계정 이메일은 실행마다 만드는 `example.invalid` 주소다.

## 실행 종료와 문제 확인

정상 종료하면 검증용 앱과 MySQL 프로세스를 종료하고 해당 실행의 임시 DB 디렉터리를 삭제한다. 준비 단계에서 만든 앱 복사본은 남는다. 실패한 실행은 원인 확인을 위해 `report/.work/run-.../`의 로그와 임시 DB를 남긴다. 이 디렉터리는 공개 자료에 포함하지 않는다.

- `mysqld`를 찾지 못하면 `--mysqld`에 전체 경로를 지정한다.
- 모듈을 찾지 못하면 `--app`이 의존성을 설치한 앱 복사본을 가리키는지 확인한다.
- `EEXIST`가 나오면 `--out`을 새 경로로 바꾼다.
- `incomplete`이면 JSON의 마지막 요청과 실패한 확인 항목을 먼저 확인한다. MySQL이나 앱 시작 실패는 콘솔에 표시된 임시 디렉터리의 로그를 확인한다.
- 실행을 강제 중단하면 정리가 완료되지 않을 수 있다. 남은 프로세스는 해당 실행의 데이터 디렉터리와 실행 경로로 식별해야 하며, 기존 MySQL 서비스를 일괄 종료하면 안 된다.

잠금 파일은 검증 당시 패키지 버전을 보존하기 위한 자료다. MySQL과 Node.js 버전은 별도로 맞춰야 하며, 새 실행 결과의 의존성 버전과 해시는 항상 `environment.json`을 기준으로 확인한다.
