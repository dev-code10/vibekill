import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createContext } from './http.mjs';
import passwordTruncation from './password-truncation.mjs';
import sessionReactivation from './session-reactivation.mjs';
import noticeAuthorization from './notice-authorization.mjs';

const reportDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = {
  'password-truncation': passwordTruncation,
  'session-reactivation': sessionReactivation,
  'notice-authorization': noticeAuthorization,
};
const { values } = parseArgs({ options: {
  app: { type: 'string', default: path.resolve(reportDir, '../moru-community') },
  mysqld: { type: 'string', default: 'mysqld' },
  out: { type: 'string' },
  case: { type: 'string', default: 'all' },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log(`Usage: node report/poc/run.mjs [options]
  --app PATH       의존성을 설치한 MORU 앱 경로
  --mysqld PATH    MySQL 8 mysqld 실행 파일 (기본값: PATH에서 검색)
  --out PATH       새 결과 디렉터리 (기존 파일 덮어쓰기 거부)
  --case NAME      all, ${Object.keys(cases).join(', ')}

새 데이터 디렉터리에 MySQL과 앱을 실행하며 기존 DB에 접속하지 않습니다.
종료 코드 0: 선택한 취약점 재현 및 정리 완료. 1: 실행 오류 또는 관측값 불일치.`);
  process.exit(0);
}
if (values.case !== 'all' && !cases[values.case]) throw new Error('알 수 없는 --case 값');
const appDir = path.resolve(values.app);
const runId = `run-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const outDir = path.resolve(values.out || path.join(reportDir, 'evidence', runId));
const workRoot = path.join(reportDir, '.work');
const requireApp = createRequire(path.join(appDir, 'package.json'));
const mysql = requireApp('mysql2/promise');
const bcrypt = requireApp('bcryptjs');
const packageJson = JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf8'));
const startedAt = new Date();
const environment = {
  startedAt: startedAt.toISOString(),
  startedAtSeoul: startedAt.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' +09:00',
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  dependencies: {},
  database: { isolation: 'fresh mysqld process and data directory', host: '127.0.0.1' },
  setup: 'schema.sql 원본 실행, 검증용 관리자 1개 SQL 생성, 일반 계정은 회원가입 API 사용',
  selectedCases: values.case === 'all' ? Object.keys(cases) : [values.case],
  sourceBefore: {}, sourceAfter: {}, sourceUnchanged: null,
  cleanup: { appStopped: false, mysqlStopped: false, temporaryDirectoryRemoved: false },
};
for (const name of Object.keys(packageJson.dependencies)) {
  environment.dependencies[name] = JSON.parse(await fs.readFile(
    path.join(appDir, 'node_modules', name, 'package.json'), 'utf8',
  )).version;
}

async function sourceHashes() {
  const result = {};
  async function walk(directory) {
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(item.name) || item.name.startsWith('.env')) continue;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await walk(absolute);
      else if (item.isFile()) {
        result[path.relative(appDir, absolute).split(path.sep).join('/')] =
          createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
      }
    }
  }
  await walk(appDir);
  return result;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(command, args, options, logPath) {
  const log = createWriteStream(logPath);
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const processState = { child, ended: false, error: null, done: null };
  child.once('error', error => { processState.error = error; });
  processState.done = new Promise(resolve => child.once('close', (code, signal) => {
    processState.ended = true;
    log.end(() => resolve({ code, signal }));
  }));
  return processState;
}

async function waitUntil(check, processState, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (processState.error) throw processState.error;
    if (processState.ended) throw new Error(`${label}: 프로세스가 먼저 종료됨`);
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`${label}: ${timeout / 1000}초 안에 준비되지 않음`);
}

async function stop(processState) {
  if (!processState || processState.ended) return true;
  processState.child.kill('SIGTERM');
  const finished = await Promise.race([processState.done.then(() => true), delay(8000, null, { ref: false }).then(() => false)]);
  if (finished) return true;
  processState.child.kill('SIGKILL');
  return Promise.race([processState.done.then(() => true), delay(8000, null, { ref: false }).then(() => false)]);
}

await fs.mkdir(path.dirname(outDir), { recursive: true });
await fs.mkdir(outDir); // EEXIST이면 기존 증거를 보존하고 종료한다.
await fs.mkdir(workRoot, { recursive: true });
const runDir = await fs.mkdtemp(path.join(workRoot, 'run-'));
const dataDir = path.join(runDir, 'mysql');
await fs.mkdir(dataDir);
let databaseProcess, initializeProcess, appProcess, root, ctx;
let errorMessage = null;

try {
  environment.sourceBefore = await sourceHashes();
  const dbPort = await unusedPort();
  environment.database.port = dbPort;
  console.log('빈 MySQL 데이터 디렉터리를 준비합니다.');
  initializeProcess = launch(values.mysqld, [
    '--no-defaults', '--initialize-insecure', `--datadir=${dataDir}`,
    `--log-error=${path.join(runDir, 'mysql-init.log')}`,
  ], {}, path.join(runDir, 'mysql-init-console.log'));
  const initialized = await Promise.race([
    initializeProcess.done,
    delay(60000, null, { ref: false }).then(() => { throw new Error('MySQL 초기화 시간 초과'); }),
  ]);
  if (initializeProcess.error) throw initializeProcess.error;
  if (initialized.code !== 0) throw new Error(`MySQL 초기화 실패 (${initialized.code})`);
  databaseProcess = launch(values.mysqld, [
    '--no-defaults', `--datadir=${dataDir}`, '--bind-address=127.0.0.1',
    `--port=${dbPort}`, '--mysqlx=0', '--skip-log-bin',
    `--socket=${path.join(runDir, 'mysql.sock')}`,
    `--log-error=${path.join(runDir, 'mysql.log')}`,
  ], {}, path.join(runDir, 'mysql-console.log'));
  await waitUntil(async () => {
    try {
      root = await mysql.createConnection({ host: '127.0.0.1', port: dbPort, user: 'root', connectTimeout: 1000, multipleStatements: true });
      return true;
    } catch { return false; }
  }, databaseProcess, 'MySQL');
  const rootPassword = randomBytes(24).toString('hex');
  await root.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [rootPassword]);
  const [version] = await root.query('SELECT VERSION() AS version');
  environment.mysql = version[0].version;
  await root.query(await fs.readFile(path.join(appDir, 'sql/schema.sql'), 'utf8'));
  const dbPassword = randomBytes(24).toString('hex');
  await root.query("CREATE USER 'report_app'@'127.0.0.1' IDENTIFIED BY ?", [dbPassword]);
  await root.query("GRANT ALL PRIVILEGES ON moru_community.* TO 'report_app'@'127.0.0.1'");
  const adminEmail = `${runId}-admin@example.invalid`;
  const adminPassword = randomBytes(18).toString('base64url');
  await root.execute('INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    [adminEmail, await bcrypt.hash(adminPassword, 12), '검증 관리자', 'admin']);

  const httpPort = await unusedPort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  environment.baseUrl = baseUrl;
  appProcess = launch(process.execPath, [path.join(appDir, 'server.js')], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(httpPort),
      DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_NAME: 'moru_community',
      DB_USER: 'report_app', DB_PASSWORD: dbPassword, SESSION_SECRET: randomBytes(32).toString('hex') },
  }, path.join(runDir, 'app.log'));
  await waitUntil(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      return response.status === 200 && (await response.json()).name === 'MORU Community';
    } catch { return false; }
  }, appProcess, 'MORU');
  ctx = createContext(baseUrl, runId);
  ctx.begin('setup');
  ctx.admin = ctx.client('admin');
  const login = await ctx.admin.request('POST', '/api/auth/login', { email: adminEmail, password: adminPassword });
  ctx.check('관리자 로그인', login.status, 200);
  ctx.check('관리자 역할 확인', login.body.user?.role, 'admin');
  ctx.current.verdict = 'ready';
  for (const name of environment.selectedCases) {
    ctx.begin(name);
    await cases[name](ctx);
    ctx.current.verdict = 'reproduced';
    console.log(`${name}: 재현 확인 (${ctx.current.checks.length}개 확인)`);
  }
} catch (error) {
  errorMessage = error.message;
  if (ctx?.current?.verdict === 'running') {
    ctx.current.verdict = 'incomplete';
    ctx.current.error = error.message;
  }
  console.error(`검증 중단: ${error.message}`);
  process.exitCode = 1;
} finally {
  environment.cleanup.appStopped = await stop(appProcess);
  await stop(initializeProcess);
  if (root) {
    try { await root.query('SHUTDOWN'); } catch { /* 서버 종료로 연결이 끊길 수 있다. */ }
    root.destroy();
  }
  if (databaseProcess && !databaseProcess.ended) {
    await Promise.race([databaseProcess.done, delay(5000, null, { ref: false })]);
  }
  environment.cleanup.mysqlStopped = await stop(databaseProcess);
  environment.sourceAfter = await sourceHashes();
  environment.sourceUnchanged = isDeepStrictEqual(environment.sourceBefore, environment.sourceAfter);
  if (!environment.sourceUnchanged) {
    errorMessage ??= '실행 전후 앱 파일 해시가 달라졌습니다.';
    process.exitCode = 1;
  }
  if (environment.cleanup.appStopped && environment.cleanup.mysqlStopped) {
    // mkdtemp로 만든 이 실행의 디렉터리만 삭제한다.
    const realWorkRoot = await fs.realpath(workRoot);
    const realRunDir = await fs.realpath(runDir);
    if (path.dirname(realRunDir) !== realWorkRoot || !path.basename(realRunDir).startsWith('run-')) {
      throw new Error('임시 디렉터리 경계 확인 실패');
    }
    if (!errorMessage) {
      try {
        await fs.rm(realRunDir, { recursive: true, maxRetries: 5, retryDelay: 300 });
        environment.cleanup.temporaryDirectoryRemoved = true;
      } catch (error) {
        errorMessage = `임시 디렉터리 정리 실패: ${error.message}`;
        process.exitCode = 1;
      }
    }
  } else {
    errorMessage ??= '검증 프로세스 종료를 확인하지 못했습니다.';
    process.exitCode = 1;
  }
  environment.completedAt = new Date().toISOString();
  environment.error = errorMessage;
  const writeJson = (name, data) => fs.writeFile(path.join(outDir, name), JSON.stringify(data, null, 2) + '\n');
  await writeJson('environment.json', environment);
  for (const result of ctx?.results || []) await writeJson(`${result.case}.json`, result);
  try { await fs.copyFile(path.join(appDir, 'package-lock.json'), path.join(outDir, 'package-lock.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lines = [
    `검증 시각: ${environment.startedAtSeoul}`,
    `Node.js ${environment.node} / MySQL ${environment.mysql || '시작 실패'}`,
    `앱 소스 변경 없음: ${environment.sourceUnchanged}`,
    '',
  ];
  for (const result of ctx?.results || []) {
    lines.push(`[${result.case}] ${result.verdict}`);
    for (const request of result.requests) lines.push(`${request.actor}: ${request.method} ${request.path} -> ${request.status ?? '응답 없음'}`);
    for (const check of result.checks) lines.push(`${check.passed ? 'OK' : 'FAIL'} ${check.name}: ${JSON.stringify(check.actual)}`);
    lines.push('');
  }
  lines.push(`정리 결과: ${JSON.stringify(environment.cleanup)}`);
  if (errorMessage) lines.push(`오류: ${errorMessage}`);
  await fs.writeFile(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
  console.log(`결과: ${outDir}`);
  if (errorMessage) console.error(`진단 로그: ${runDir}`);
}
