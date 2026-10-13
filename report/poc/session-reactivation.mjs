export default async function verify(ctx) {
  const password = ctx.password();
  const { client: sessionA, user } = await ctx.register('session-A', password);
  const sessionB = ctx.client('session-B');
  const loginB = await sessionB.request('POST', '/api/auth/login', {
    email: user.email, password,
  });
  ctx.check('세션 B 로그인', loginB.status, 200);
  const cookieA = sessionA.cookie;
  const cookieB = sessionB.cookie;
  ctx.check('서로 다른 세션 두 개 발급', Boolean(cookieA && cookieB && cookieA !== cookieB), true);
  for (const client of [sessionA, sessionB]) {
    const me = await client.request('GET', '/api/me');
    ctx.check(`${client.label} 정지 전 인증`, me.status, 200);
    ctx.check(`${client.label} 사용자 일치`, me.body.user?.id, user.id);
  }
  const statusPath = `/api/admin/users/${user.id}/status`;
  const suspended = await ctx.admin.request('PATCH', statusPath, { isActive: false });
  ctx.check('관리자 계정 정지', suspended.status, 200);
  const during = await sessionA.request('GET', '/api/me', undefined, cookieA);
  ctx.check('정지 중 세션 A 거부', during.status, 401);
  const blockedLogin = await ctx.client('suspended-login').request('POST', '/api/auth/login', {
    email: user.email, password,
  });
  ctx.check('정지 중 새 로그인 거부', blockedLogin.status, 401);

  // B로 요청하면 서버가 B도 폐기하므로 정지 중에는 B를 사용하지 않는다.
  const resumed = await ctx.admin.request('PATCH', statusPath, { isActive: true });
  ctx.check('관리자 정지 해제', resumed.status, 200);
  const oldA = await sessionA.request('GET', '/api/me', undefined, cookieA);
  ctx.check('정지 중 사용한 A는 해제 후에도 거부', oldA.status, 401);
  const oldB = await sessionB.request('GET', '/api/me', undefined, cookieB);
  ctx.check('정지 중 미사용한 B는 해제 후 인증됨', oldB.status, 200);
  ctx.check('세션 B 사용자 일치', oldB.body.user?.id, user.id);
  ctx.note('replay', { newLoginAfterReactivation: false, usedOriginalCookieB: true });
}
