import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isLoopback, localServiceKey } from "./local-access.js";
import { tokenEqual, wrap } from "./http.js";

const derive = promisify(scrypt);
const COOKIE = "luckytri_session";
const MONTH = 30 * 86400000;
const sessionHash = (value) => createHash("sha256").update(value).digest("hex");
const digest = async (password, salt) =>
  (await derive(password, salt, 64)).toString("hex");
function validate(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 256
  )
    throw Error("密码长度应为 8–256 个字符");
}

export function createManagementAuth(
  store,
  { key = localServiceKey(), now = Date.now } = {},
) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS management_auth(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS management_sessions(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  const record = () =>
    db.prepare("SELECT salt,hash FROM management_auth WHERE id=1").get();
  const failures = new Map();
  function throttle(req) {
    const address = req.socket.remoteAddress || "unknown";
    const entry = failures.get(address);
    if (entry && now() - entry.at < 300000 && entry.count >= 8) {
      const error = Error("尝试次数过多，请稍后再试");
      error.status = 429;
      throw error;
    }
    if (!entry || now() - entry.at >= 300000)
      failures.set(address, { count: 0, at: now() });
    if (failures.size > 1000) failures.delete(failures.keys().next().value);
    return failures.get(address);
  }
  async function verifyPassword(password) {
    const saved = record();
    if (!saved || typeof password !== "string" || password.length > 256)
      return false;
    const result = Buffer.from(await digest(password, saved.salt), "hex");
    const expected = Buffer.from(saved.hash, "hex");
    return (
      result.length === expected.length &&
      timingSafeEqual(result, expected) &&
      record()?.hash === saved.hash
    );
  }
  function cookie(req) {
    return (
      String(req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(COOKIE + "="))
        ?.slice(COOKIE.length + 1) || ""
    );
  }
  function authorized(req) {
    const id = cookie(req);
    if (!/^[\w-]{43}$/.test(id)) return false;
    return !!db
      .prepare("SELECT 1 FROM management_sessions WHERE id=? AND expires>?")
      .get(sessionHash(id), now());
  }
  function service(req) {
    return (
      isLoopback(req.socket.remoteAddress) &&
      tokenEqual(req.headers.authorization, `Bearer ${key}`)
    );
  }
  function session(req, res) {
    db.prepare("DELETE FROM management_sessions WHERE expires<=?").run(now());
    const id = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO management_sessions(id,expires) VALUES (?,?)").run(
      sessionHash(id),
      now() + MONTH,
    );
    db.exec(
      "DELETE FROM management_sessions WHERE id NOT IN (SELECT id FROM management_sessions ORDER BY expires DESC LIMIT 100)",
    );
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      maxAge: MONTH,
      path: "/",
    });
  }
  function mount(app) {
    app.post("/api/auth/reset", (req, res) => {
      if (!service(req))
        return res.status(401).json({ error: "请使用本机命令重置管理密码" });
      db.exec(
        "BEGIN IMMEDIATE; DELETE FROM management_auth; DELETE FROM management_sessions; COMMIT;",
      );
      res.clearCookie(COOKIE, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.secure,
        path: "/",
      });
      res.json({ ok: true });
    });
    app.get("/api/auth/status", (req, res) =>
      res.json({ configured: !!record(), authenticated: authorized(req) }),
    );
    app.post(
      "/api/auth/setup",
      wrap(async (req, res) => {
        if (
          !isLoopback(req.socket.remoteAddress) ||
          !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname)
        ) {
          const error = Error("首次设置密码请在本机打开管理台");
          error.status = 403;
          throw error;
        }
        if (record()) {
          const error = Error("管理密码已设置，请登录");
          error.status = 409;
          throw error;
        }
        validate(req.body.password);
        const salt = randomBytes(16).toString("hex");
        const hash = await digest(req.body.password, salt);
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO management_auth(id,salt,hash) VALUES (1,?,?)",
          )
          .run(salt, hash);
        if (!inserted.changes) {
          const error = Error("管理密码已设置，请登录");
          error.status = 409;
          throw error;
        }
        session(req, res);
        res.json({ ok: true });
      }),
    );
    app.post(
      "/api/auth/login",
      wrap(async (req, res) => {
        const entry = throttle(req);
        entry.count++;
        if (!(await verifyPassword(req.body.password))) {
          const error = Error("密码不正确");
          error.status = 401;
          throw error;
        }
        entry.count = 0;
        session(req, res);
        res.json({ ok: true });
      }),
    );
    app.post("/api/auth/logout", (req, res) => {
      db.prepare("DELETE FROM management_sessions WHERE id=?").run(
        sessionHash(cookie(req)),
      );
      res.clearCookie(COOKIE, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.secure,
        path: "/",
      });
      res.json({ ok: true });
    });
    app.post(
      "/api/auth/password",
      wrap(async (req, res) => {
        if (!authorized(req)) {
          const error = Error("请先登录管理台");
          error.status = 401;
          throw error;
        }
        const entry = throttle(req);
        entry.count++;
        const previous = record();
        if (!(await verifyPassword(req.body.currentPassword)))
          throw Error("当前密码不正确");
        validate(req.body.password);
        const salt = randomBytes(16).toString("hex"),
          hash = await digest(req.body.password, salt);
        const changed = db
          .prepare(
            "UPDATE management_auth SET salt=?,hash=? WHERE id=1 AND hash=?",
          )
          .run(salt, hash, previous.hash);
        if (!changed.changes) throw Error("密码已变化，请重新登录");
        db.exec("DELETE FROM management_sessions");
        entry.count = 0;
        session(req, res);
        res.json({ ok: true });
      }),
    );
  }
  return {
    mount,
    authorized,
    service,
    configured: () => !!record(),
    verifyPassword,
    async verifyConnectionPassword(password, address) {
      const entry = throttle({ socket: { remoteAddress: address } });
      entry.count++;
      const valid = await verifyPassword(password);
      if (valid) entry.count = 0;
      return valid;
    },
  };
}
