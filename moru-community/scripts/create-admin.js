'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const [emailArg, passwordArg, ...nameParts] = process.argv.slice(2);
  const displayName = nameParts.join(' ').trim() || '관리자';
  if (!emailArg || !passwordArg || passwordArg.length < 8 || passwordArg.length > 72) {
    console.error('사용법: npm run admin:create -- admin@example.com "강력한비밀번호" "관리자 닉네임"');
    console.error('비밀번호는 8~72자여야 합니다.');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('올바른 이메일 주소를 입력하세요.'); process.exit(1);
  }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'moru_community', charset: 'utf8mb4'
  });
  try {
    const hash = await bcrypt.hash(passwordArg, 12);
    await db.execute(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), role = 'admin', is_active = 1`,
      [email, hash, displayName]
    );
    console.log(`관리자 계정이 준비되었습니다: ${email}`);
  } finally { await db.end(); }
})().catch((error) => { console.error('관리자 계정 생성 실패:', error.message); process.exit(1); });
