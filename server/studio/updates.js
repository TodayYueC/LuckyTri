import { SOURCE_CHECKOUT } from "../paths.js";
import { USER_AGENT, VERSION } from "../version.js";

const REGISTRY = "https://registry.npmjs.org/luckytri/latest";
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parts(value) {
  const m =
    typeof value === "string" && value.length <= 100 && value.match(SEMVER);
  if (!m || m.slice(1, 4).some((n) => !Number.isSafeInteger(Number(n))))
    return null;
  if (m[4]?.split(".").some((part) => /^0\d+$/.test(part))) return null;
  return { numbers: m.slice(1, 4).map(Number), pre: m[4]?.split(".") || [] };
}
export function compareVersions(a, b) {
  const left = parts(a),
    right = parts(b);
  if (!left || !right) throw Error("版本信息无效");
  for (let i = 0; i < 3; i++)
    if (left.numbers[i] !== right.numbers[i])
      return Math.sign(left.numbers[i] - right.numbers[i]);
  if (!left.pre.length || !right.pre.length)
    return Math.sign(Number(!left.pre.length) - Number(!right.pre.length));
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i],
      y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// A manual, bounded metadata read. It never installs code, runs commands or
// sends instance data, model keys or npm login credentials to the registry.
export class UpdateChecker {
  constructor({
    fetch: fetcher = globalThis.fetch,
    now = Date.now,
    current = VERSION,
    source = SOURCE_CHECKOUT,
    timeout = 10000,
  } = {}) {
    this.fetch = fetcher;
    this.now = now;
    this.current = current;
    this.source = source;
    this.timeout = timeout;
    this.latest = null;
    this.checkedAt = null;
    this.lastAttempt = null;
    this.error = "";
    this.pending = null;
  }
  status() {
    return {
      current: this.current,
      latest: this.latest,
      checkedAt: this.checkedAt,
      error: this.error,
      status: this.error
        ? "unavailable"
        : !this.latest
          ? "unchecked"
          : compareVersions(this.latest, this.current) > 0
            ? "available"
            : compareVersions(this.latest, this.current) === 0
              ? "current"
              : "ahead",
      installation: this.source ? "source" : "npm",
      npmUrl: "https://www.npmjs.com/package/luckytri",
      releaseUrl: "https://github.com/TodayYueC/LuckyTri/releases",
    };
  }
  check() {
    if (this.pending) return this.pending;
    const now = this.now();
    const elapsed =
      this.lastAttempt == null ? Infinity : now - this.lastAttempt;
    if (elapsed >= 0 && elapsed < (this.error ? 15000 : 300000))
      return Promise.resolve({ ...this.status(), cached: true });
    this.lastAttempt = now;
    this.pending = this.read().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async read() {
    let response;
    try {
      response = await this.fetch(REGISTRY, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > 65536)
        throw Error("版本信息过大");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 65536) throw Error("版本信息过大");
        chunks.push(Buffer.from(chunk));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (data.name !== "luckytri" || !parts(data.version))
        throw Error("版本信息无效");
      this.latest = data.version;
      this.checkedAt = this.now();
      this.error = "";
    } catch {
      try {
        await response?.body?.cancel();
      } catch {
        /* Already consumed or cancelled. */
      }
      this.error = "暂时无法连接 npm 或读取版本信息，请稍后重试。";
    }
    return { ...this.status(), cached: false };
  }
}

export function mountUpdates(app, checker, updater) {
  const view = (info) => ({ ...info, operation: updater?.status() || null });
  app.get("/api/system/update", (_req, res) =>
    res.json(view(checker.status())),
  );
  app.post("/api/system/update/check", async (_req, res) =>
    res.json(view(await checker.check())),
  );
  app.post("/api/system/update/install", async (req, res) => {
    try {
      if (!updater) throw Error("当前实例不支持自动更新");
      res.json(await updater.install(req.body.version));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}
