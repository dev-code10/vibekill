import { randomBytes } from 'node:crypto';

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [
    key, /password|cookie|secret|token/i.test(key) ? '[redacted]' : redact(val),
  ]));
}

export function createContext(baseUrl, runId) {
  const ctx = {
    current: null,
    results: [],
    password: () => randomBytes(18).toString('base64url'),
    begin(name) {
      this.current = { case: name, verdict: 'running', checks: [], notes: {}, requests: [] };
      this.results.push(this.current);
    },
    note(key, value) { this.current.notes[key] = value; },
    check(name, actual, expected) {
      const passed = actual === expected;
      this.current.checks.push({ name, actual: actual ?? null, expected, passed });
      if (!passed) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    client(label) {
      return {
        label, cookie: '',
        async request(method, path, body, savedCookie) {
          const cookie = savedCookie ?? this.cookie;
          const headers = { Origin: baseUrl };
          if (cookie) headers.Cookie = cookie;
          if (body !== undefined) headers['Content-Type'] = 'application/json';
          const record = {
            actor: label, method, path,
            cookieSent: Boolean(cookie),
            requestBody: body === undefined ? null : redact(body),
          };
          ctx.current.requests.push(record);
          const response = await fetch(`${baseUrl}${path}`, {
            method, headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'error', signal: AbortSignal.timeout(15000),
          });
          for (const setCookie of response.headers.getSetCookie()) {
            if (setCookie.startsWith('moru.sid=')) this.cookie = setCookie.split(';')[0];
          }
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); }
          catch { throw new Error(`${method} ${path}: JSON 응답이 아님 (HTTP ${response.status})`); }
          record.status = response.status;
          record.responseBody = redact(data);
          record.sessionCookieSet = response.headers.getSetCookie().some(c => c.startsWith('moru.sid='));
          return { status: response.status, body: data };
        },
      };
    },
    async register(label, password = this.password()) {
      const client = this.client(label);
      const email = `${runId}-${label}@example.invalid`;
      const response = await client.request('POST', '/api/auth/register', {
        email, password, displayName: `검증 ${label}`,
      });
      this.check(`${label} 회원가입`, response.status, 201);
      this.check(`${label} 일반 사용자로 생성`, response.body.user?.role, 'user');
      return { client, user: response.body.user };
    },
  };
  return ctx;
}
