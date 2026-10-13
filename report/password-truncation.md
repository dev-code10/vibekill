# 비밀번호 72바이트 절단

회원가입에 사용한 비밀번호의 마지막 문자를 바꿔도 같은 계정에 로그인됐다. 서버의 길이 검사와 bcrypt의 입력 처리 단위가 달라, UTF-8 기준 72바이트를 넘는 비밀번호가 그대로 가입을 통과했다.

## 재현 조건

`bcryptjs 2.4.3`을 사용하는 현재 회원가입 및 로그인 경로가 대상이다. 두 비밀번호의 첫 72바이트가 같고 차이가 그 뒤에 있어야 한다.

검증에는 아래 세 문자열을 사용했다. `'가'` 한 글자는 UTF-8에서 3바이트이므로 24개를 붙이면 정확히 72바이트가 된다.

```javascript
const original = '가'.repeat(24) + 'A';
const alternate = '가'.repeat(24) + 'B';
const control = '나' + '가'.repeat(23) + 'B';
```

| 문자열 | JavaScript length | UTF-8 크기 | 가입 비밀번호와의 차이 |
| --- | --- | --- | --- |
| original | 25 | 73바이트 | 가입에 사용 |
| alternate | 25 | 73바이트 | 73번째 바이트만 다름 |
| control | 25 | 73바이트 | 첫 72바이트 안에도 차이가 있음 |

## 검증 과정과 결과

1. `original`로 `POST /api/auth/register`를 호출했다. 가입은 `201`로 처리됐고 일반 계정이 생성됐다.
2. 쿠키가 없는 별도 클라이언트에서 같은 이메일과 `original`로 로그인했다. 응답은 `200`이었다.
3. 같은 이메일과 `control`로 로그인했다. 응답은 `401`이었다.
4. 같은 이메일과 `alternate`로 로그인했다. 응답은 `200`이었고 가입한 계정과 동일한 사용자 ID가 반환됐다.
5. 마지막 요청에서 발급받은 세션으로 `GET /api/me`를 호출했다. `200`과 같은 사용자 ID가 반환됐다.

가입 응답의 사용자 ID는 `2`였고, 다른 비밀번호로 로그인한 응답과 `/api/me`에서도 `2`가 확인됐다. 이 번호는 첨부한 실행 기록의 값이며 다시 실행하면 달라질 수 있다.

| 로그인 비밀번호 | 기대 결과 | 실제 결과 |
| --- | --- | --- |
| original | 성공 | `200` |
| control | 실패 | `401` |
| alternate | 실패 | `200`, 같은 계정으로 인증 |

로그인 성공 응답만 확인한 것이 아니라 발급 세션이 인증 경로에서 사용되는 것까지 확인했다. [요청과 응답 기록](evidence/2026-10-13/password-truncation.json) · [검증 코드](poc/password-truncation.mjs)

## 원인

회원가입은 [server.js 203행](https://github.com/dev-code10/vibekill/blob/9fda842dda38a933034159e539ea7544c67615ac/moru-community/server.js#L203)에서 `password.length`를 검사한다.

```javascript
if (password.length < 8 || password.length > 72)
```

JavaScript의 `length`는 UTF-16 코드 단위 수다. 위 문자열은 길이가 25라서 통과하지만 UTF-8로는 73바이트다. 통과한 값은 [211행의 bcrypt.hash](https://github.com/dev-code10/vibekill/blob/9fda842dda38a933034159e539ea7544c67615ac/moru-community/server.js#L211)에 전달되고, 로그인에서는 [245행의 bcrypt.compare](https://github.com/dev-code10/vibekill/blob/9fda842dda38a933034159e539ea7544c67615ac/moru-community/server.js#L245)로 비교한다.

bcrypt는 비밀번호의 앞 72바이트를 처리한다. 따라서 `original`과 `alternate`의 마지막 문자는 이 계정의 인증 결과에 영향을 주지 않는다. 이 제한은 [bcryptjs 문서의 Security considerations](https://github.com/dcodeIO/bcrypt.js#security-considerations)에도 설명돼 있다.

## 영향

사용자가 입력한 비밀번호 전체가 인증에 반영되지 않는다. 첫 72바이트가 같으면 그 뒤의 값을 달리 입력해도 인증이 성공한다. 특히 한글 등 여러 바이트로 표현되는 문자를 쓰면 화면에 보이는 길이가 짧아도 제한을 넘을 수 있다.

재현에는 첫 72바이트가 같은 비밀번호가 필요하다. 이번 결과만으로 비밀번호를 전혀 모르는 공격자의 계정 탈취나 임의 비밀번호 로그인이 가능하다고 볼 수는 없다. 앱에 비밀번호 변경 기능이 없으므로 변경 후 동작은 검증하지 않았다.

## 수정 방향

bcrypt를 유지한다면 가입 단계에서 UTF-8 바이트 길이를 검사해 초과 입력을 거부해야 한다. 입력값을 잘라서 저장하면 지금과 같은 문제가 남는다.

```javascript
if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
  return res.status(400).json({
    error: '비밀번호는 8자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.',
  });
}
```

이는 가입 입력 검사의 예시다. 관리자 생성 경로도 같은 기준을 적용해야 한다. 이미 초과 길이로 가입한 계정은 저장된 해시만으로 원래 입력의 뒷부분을 확인할 수 없으므로, 로그인 검증만 바꾸기 전에 비밀번호 재설정 등 기존 계정의 전환 절차가 필요하다.

수정 후에는 72바이트를 초과하는 가입이 거부되는지, 허용 범위 안의 서로 다른 비밀번호가 구분되는지 확인한다. ASCII 입력뿐 아니라 한글과 이모지로 바이트 경계를 확인해야 한다.
