export default async function verify(ctx) {
  const original = '가'.repeat(24) + 'A';
  const samePrefix = '가'.repeat(24) + 'B';
  const differentPrefix = '나' + '가'.repeat(23) + 'B';
  ctx.note('passwords', {
    original: "'가'.repeat(24) + 'A'",
    alternate: "'가'.repeat(24) + 'B'",
    jsLength: original.length,
    utf8Bytes: Buffer.byteLength(original, 'utf8'),
    sharedPrefixBytes: 72,
  });
  ctx.check('두 비밀번호가 다름', original !== samePrefix, true);
  const { user } = await ctx.register('password-owner', original);
  const valid = ctx.client('original-password');
  const validLogin = await valid.request('POST', '/api/auth/login', {
    email: user.email, password: original,
  });
  ctx.check('가입 비밀번호 로그인', validLogin.status, 200);

  const control = ctx.client('different-prefix');
  const rejected = await control.request('POST', '/api/auth/login', {
    email: user.email, password: differentPrefix,
  });
  ctx.check('첫 72바이트가 다른 비밀번호 거부', rejected.status, 401);

  const alternate = ctx.client('alternate-password');
  const accepted = await alternate.request('POST', '/api/auth/login', {
    email: user.email, password: samePrefix,
  });
  ctx.check('72바이트 뒤만 다른 비밀번호 로그인', accepted.status, 200);
  ctx.check('같은 계정으로 로그인됨', accepted.body.user?.id, user.id);
  const me = await alternate.request('GET', '/api/me');
  ctx.check('발급 세션으로 인증됨', me.status, 200);
  ctx.check('인증된 사용자 일치', me.body.user?.id, user.id);
}
