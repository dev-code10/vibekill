"use strict";
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MySQLStoreFactory = require("express-mysql-session")(session);
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const categories = ["자유", "질문", "정보", "일상", "공지"];
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error(
    "오류: .env의 SESSION_SECRET에 32자 이상의 임의 문자열을 설정하세요.",
  );
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "moru_community",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
};
const pool = mysql.createPool(dbConfig);
const sessionStore = new MySQLStoreFactory({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000,
});

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(
  session({
    name: "moru.sid",
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const source = req.get("origin") || req.get("referer");
  if (!source) return next(); // Non-browser clients may not send Origin/Referer.
  try {
    if (new URL(source).host !== req.get("host"))
      return res.status(403).json({ error: "요청 출처를 확인할 수 없습니다." });
  } catch (_) {
    return res.status(403).json({ error: "요청 출처를 확인할 수 없습니다." });
  }
  next();
});
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
  }),
);
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    maxAge: isProduction ? "1h" : 0,
  }),
);

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = (user) => ({
  id: Number(user.id),
  email: user.email,
  displayName: user.display_name,
  bio: user.bio || "",
  avatarUrl: user.avatar_url || "",
  role: user.role,
  isActive: Boolean(user.is_active),
  createdAt: user.created_at,
});
const cleanString = (value) => (typeof value === "string" ? value.trim() : "");
const validEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const validAvatarUrl = (value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && Boolean(url.hostname) && value.length <= 500
    );
  } catch (_) {
    return false;
  }
};

async function findUser(id) {
  const [rows] = await pool.execute(
    "SELECT id, email, display_name, bio, avatar_url, role, is_active, created_at FROM users WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
}
async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId)
      return res.status(401).json({ error: "로그인이 필요합니다." });
    const user = await findUser(req.session.userId);
    if (!user || !user.is_active) {
      req.session.destroy(() => {});
      return res
        .status(401)
        .json({ error: "계정이 비활성화되었거나 로그인이 만료되었습니다." });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  next();
}
function validatePost(body) {
  const title = cleanString(body.title);
  const content = cleanString(body.content);
  const category = cleanString(body.category || "자유");
  if (title.length < 2 || title.length > 150)
    return { error: "제목은 2~150자로 입력해 주세요." };
  if (content.length < 5 || content.length > 30000)
    return { error: "본문은 5~30,000자로 입력해 주세요." };
  if (!categories.includes(category))
    return { error: "올바른 게시판을 선택해 주세요." };
  return { title, content, category };
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, name: "MORU Community" }),
);

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const email = cleanString(req.body.email).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const displayName = cleanString(req.body.displayName);
    if (!validEmail(email))
      return res
        .status(400)
        .json({ error: "올바른 이메일 주소를 입력해 주세요." });
    if (password.length < 8 || password.length > 72)
      return res
        .status(400)
        .json({ error: "비밀번호는 8~72자로 입력해 주세요." });
    if (displayName.length < 2 || displayName.length > 40)
      return res
        .status(400)
        .json({ error: "닉네임은 2~40자로 입력해 주세요." });
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const [result] = await pool.execute(
        "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
        [email, passwordHash, displayName],
      );
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve())),
      );
      req.session.userId = result.insertId;
      const user = await findUser(result.insertId);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "이미 가입된 이메일입니다." });
      throw error;
    }
  }),
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const email = cleanString(req.body.email).toLowerCase();
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [email],
    );
    const user = rows[0];
    if (
      !user ||
      !user.is_active ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호를 확인해 주세요." });
    }
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  }),
);

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("moru.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    });
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) =>
  res.json({ user: publicUser(req.user) }),
);
app.patch(
  "/api/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const displayName = cleanString(req.body.displayName);
    const bio = cleanString(req.body.bio);
    const avatarUrl = cleanString(req.body.avatarUrl);
    if (displayName.length < 2 || displayName.length > 40)
      return res
        .status(400)
        .json({ error: "닉네임은 2~40자로 입력해 주세요." });
    if (bio.length > 280)
      return res
        .status(400)
        .json({ error: "소개는 280자 이내로 입력해 주세요." });
    if (!validAvatarUrl(avatarUrl))
      return res
        .status(400)
        .json({ error: "프로필 이미지는 https 주소만 사용할 수 있습니다." });
    await pool.execute(
      "UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?",
      [displayName, bio, avatarUrl || null, req.user.id],
    );
    res.json({ user: publicUser(await findUser(req.user.id)) });
  }),
);

app.get(
  "/api/posts",
  asyncRoute(async (req, res) => {
    const page = Math.max(
      1,
      Math.min(10000, parseInt(req.query.page, 10) || 1),
    );
    const limit = 10;
    const offset = (page - 1) * limit;
    const category = cleanString(req.query.category);
    const search = cleanString(req.query.search).slice(0, 100);
    const sort =
      req.query.sort === "views"
        ? "p.view_count DESC, p.created_at DESC"
        : "p.created_at DESC";
    const where = [];
    const params = [];
    if (category && categories.includes(category)) {
      where.push("p.category = ?");
      params.push(category);
    }
    if (search) {
      where.push(
        "(p.title LIKE ? OR p.content LIKE ? OR u.display_name LIKE ?)",
      );
      const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      params.push(term, term, term);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id = p.user_id ${clause}`,
      params,
    );
    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.content, p.category, p.view_count, p.created_at, p.updated_at,
      u.id AS user_id, u.display_name, u.avatar_url,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
     FROM posts p JOIN users u ON u.id = p.user_id ${clause}
     ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json({
      posts: rows.map((p) => ({
        id: Number(p.id),
        title: p.title,
        excerpt:
          p.content.length > 210 ? `${p.content.slice(0, 210)}…` : p.content,
        category: p.category,
        viewCount: Number(p.view_count),
        commentCount: Number(p.comment_count),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        author: {
          id: Number(p.user_id),
          displayName: p.display_name,
          avatarUrl: p.avatar_url || "",
        },
      })),
      page,
      limit,
      total: Number(countRows[0].total),
      totalPages: Math.max(1, Math.ceil(Number(countRows[0].total) / limit)),
    });
  }),
);

app.post(
  "/api/posts",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = validatePost(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    if (input.category === "공지" && req.user.role !== "admin")
      return res
        .status(403)
        .json({ error: "공지 게시글은 관리자만 작성할 수 있습니다." });
    const [result] = await pool.execute(
      "INSERT INTO posts (user_id, title, content, category) VALUES (?, ?, ?, ?)",
      [req.user.id, input.title, input.content, input.category],
    );
    res
      .status(201)
      .json({ id: Number(result.insertId), message: "게시글을 등록했습니다." });
  }),
);

app.get(
  "/api/posts/:id",
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 게시글 번호입니다." });
    const [rows] = await pool.execute(
      `SELECT p.id, p.user_id, p.title, p.content, p.category, p.view_count, p.created_at, p.updated_at,
      u.display_name, u.avatar_url, u.role AS author_role
     FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    const shouldCountView = req.query.view === "1";
    if (shouldCountView)
      await pool.execute(
        "UPDATE posts SET view_count = view_count + 1 WHERE id = ?",
        [id],
      );
    const p = rows[0];
    const [comments] = await pool.execute(
      `SELECT c.id, c.content, c.created_at, c.user_id, u.display_name, u.avatar_url, u.role
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [id],
    );
    res.json({
      post: {
        id: Number(p.id),
        title: p.title,
        content: p.content,
        category: p.category,
        viewCount: Number(p.view_count) + (shouldCountView ? 1 : 0),
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        author: {
          id: Number(p.user_id),
          displayName: p.display_name,
          avatarUrl: p.avatar_url || "",
          role: p.author_role,
        },
      },
      comments: comments.map((c) => ({
        id: Number(c.id),
        content: c.content,
        createdAt: c.created_at,
        userId: Number(c.user_id),
        author: {
          displayName: c.display_name,
          avatarUrl: c.avatar_url || "",
          role: c.role,
        },
      })),
    });
  }),
);

app.patch(
  "/api/posts/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const input = validatePost(req.body);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 게시글 번호입니다." });
    if (input.error) return res.status(400).json({ error: input.error });
    const [rows] = await pool.execute(
      "SELECT user_id FROM posts WHERE id = ?",
      [id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    if (Number(rows[0].user_id) !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "수정 권한이 없습니다." });
    if (input.category === "공지" && req.user.role !== "admin")
      return res
        .status(403)
        .json({ error: "공지 게시글은 관리자만 작성할 수 있습니다." });
    await pool.execute(
      "UPDATE posts SET title = ?, content = ?, category = ? WHERE id = ?",
      [input.title, input.content, input.category, id],
    );
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/posts/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 게시글 번호입니다." });
    const [rows] = await pool.execute(
      "SELECT user_id FROM posts WHERE id = ?",
      [id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    if (Number(rows[0].user_id) !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "삭제 권한이 없습니다." });
    await pool.execute("DELETE FROM posts WHERE id = ?", [id]);
    res.json({ ok: true });
  }),
);

app.post(
  "/api/posts/:id/comments",
  requireAuth,
  asyncRoute(async (req, res) => {
    const postId = Number(req.params.id);
    const content = cleanString(req.body.content);
    if (!Number.isSafeInteger(postId) || postId < 1)
      return res.status(400).json({ error: "잘못된 게시글 번호입니다." });
    if (!content || content.length > 2000)
      return res
        .status(400)
        .json({ error: "댓글은 1~2,000자로 입력해 주세요." });
    const [posts] = await pool.execute("SELECT id FROM posts WHERE id = ?", [
      postId,
    ]);
    if (!posts.length)
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    const [result] = await pool.execute(
      "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)",
      [postId, req.user.id, content],
    );
    res.status(201).json({ id: Number(result.insertId), ok: true });
  }),
);

app.delete(
  "/api/comments/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 댓글 번호입니다." });
    const [rows] = await pool.execute(
      "SELECT user_id FROM comments WHERE id = ?",
      [id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });
    if (Number(rows[0].user_id) !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "댓글 삭제 권한이 없습니다." });
    await pool.execute("DELETE FROM comments WHERE id = ?", [id]);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/admin/stats",
  requireAuth,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const [[users]] = await pool.query(
      "SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM users",
    );
    const [[posts]] = await pool.query("SELECT COUNT(*) AS total FROM posts");
    const [[comments]] = await pool.query(
      "SELECT COUNT(*) AS total FROM comments",
    );
    res.json({
      users: Number(users.total),
      activeUsers: Number(users.active || 0),
      posts: Number(posts.total),
      comments: Number(comments.total),
    });
  }),
);

app.get(
  "/api/admin/users",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const [rows] = await pool.execute(
      "SELECT id, email, display_name, role, is_active, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, (page - 1) * limit],
    );
    const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM users");
    res.json({
      users: rows.map((u) => ({
        id: Number(u.id),
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        isActive: Boolean(u.is_active),
        createdAt: u.created_at,
      })),
      page,
      total: Number(count.total),
    });
  }),
);

app.patch(
  "/api/admin/users/:id/role",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const role = req.body.role;
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["user", "admin"].includes(role)
    )
      return res.status(400).json({ error: "잘못된 요청입니다." });
    if (id === req.user.id && role !== "admin")
      return res
        .status(400)
        .json({ error: "현재 로그인한 관리자의 권한은 변경할 수 없습니다." });
    const [result] = await pool.execute(
      "UPDATE users SET role = ? WHERE id = ?",
      [role, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true });
  }),
);

app.patch(
  "/api/admin/users/:id/status",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const isActive = req.body.isActive;
    if (!Number.isSafeInteger(id) || id < 1 || typeof isActive !== "boolean")
      return res.status(400).json({ error: "잘못된 요청입니다." });
    if (id === req.user.id && !isActive)
      return res
        .status(400)
        .json({ error: "현재 로그인한 계정은 비활성화할 수 없습니다." });
    const [result] = await pool.execute(
      "UPDATE users SET is_active = ? WHERE id = ?",
      [isActive ? 1 : 0, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/admin/users/:id",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 사용자 번호입니다." });
    if (id === req.user.id)
      return res
        .status(400)
        .json({ error: "현재 로그인한 계정은 삭제할 수 없습니다." });
    const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true });
  }),
);

app.get(
  "/api/admin/posts",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.category, p.created_at, u.display_name
     FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [limit, (page - 1) * limit],
    );
    const [[count]] = await pool.query("SELECT COUNT(*) AS total FROM posts");
    res.json({
      posts: rows.map((p) => ({
        id: Number(p.id),
        title: p.title,
        category: p.category,
        author: p.display_name,
        createdAt: p.created_at,
      })),
      page,
      total: Number(count.total),
    });
  }),
);

app.delete(
  "/api/admin/posts/:id",
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "잘못된 게시글 번호입니다." });
    const [result] = await pool.execute("DELETE FROM posts WHERE id = ?", [id]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
    res.json({ ok: true });
  }),
);

// The admin interface is served by the same client bundle but has its own URL.
app.get("/admin", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "존재하지 않는 API입니다." });
  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (err) => err && next(err),
  );
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_DB_ERROR") {
    return res
      .status(503)
      .json({
        error:
          "데이터베이스가 준비되지 않았습니다. README.md의 데이터베이스 설정을 확인해 주세요.",
      });
  }
  res
    .status(500)
    .json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
});

async function start() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    await sessionStore.onReady();
    app.listen(PORT, () =>
      console.log(`MORU Community 실행 중: http://localhost:${PORT}`),
    );
  } catch (error) {
    console.error(
      "MySQL 연결에 실패했습니다. .env와 데이터베이스 설정을 확인하세요.",
      error.message,
    );
    process.exit(1);
  }
}
start();
