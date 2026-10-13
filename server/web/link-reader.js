// Reading a link someone sent: fetch the public page, keep the readable text,
// and give her a short note of what it is. "I can't open links" was one of the
// most robotic things she said (round 24 real logs). Only public http(s)
// pages are read: private, loopback and link-local addresses are refused at
// every redirect hop, bodies are capped, and nothing is sent with cookies.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const LINK_LIMITS = {
  timeoutMs: 8000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  perTurn: 2,
  textChars: 6000,
  ttlMs: 6 * 3600 * 1000,
};
const USER_AGENT = "LuckyTri-LinkReader/1.0 (+https://github.com/LuckyTri)";
const TEXT_TYPES =
  /^(?:text\/html|application\/xhtml\+xml|text\/plain|application\/json|text\/markdown|application\/vnd\.github[\w.+-]*)/i;

export function linksIn(text) {
  const found = [];
  for (const match of String(text || "").matchAll(
    /https?:\/\/[^\s<>"'（）「」，。！？、]+/gi,
  )) {
    const url = match[0].replace(/[),.;:!?]+$/, "");
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      parsed.hash = "";
      const clean = parsed.toString();
      if (!found.includes(clean)) found.push(clean);
    } catch {
      // Not a URL after all.
    }
  }
  return found;
}

// Addresses that must never be reached from a chat message. 198.18.0.0/15
// stays allowed: fake-IP proxies (Clash and the like, common on the owner's
// machine) answer every public name from that range.
export function privateAddress(address) {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const v = address.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return (
      v === "::" ||
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff")
    );
  }
  return true;
}

async function safeHost(hostname, resolve) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) return false;
  if (isIP(host)) return !privateAddress(host);
  let addresses;
  try {
    addresses = await resolve(host);
  } catch {
    return false;
  }
  return (
    addresses.length > 0 && addresses.every((a) => !privateAddress(a.address))
  );
}

const decode = (text) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

// Readable text from a page: title, description and the body without
// scripts, styles, navigation, headers and footers.
export function readable(html) {
  const meta = (name) => {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      "i",
    );
    const m = html.match(re);
    return m ? decode(m[1] || m[2] || "").trim() : "";
  };
  const title =
    meta("og:title") ||
    decode((html.match(/<title[^>]*>([^]*?)<\/title>/i) || [])[1] || "").trim();
  const description = meta("og:description") || meta("description");
  const main =
    (html.match(/<(?:main|article)[^>]*>([^]*?)<\/(?:main|article)>/i) ||
      [])[1] ||
    (html.match(/<body[^>]*>([^]*?)<\/body>/i) || [])[1] ||
    html;
  const text = decode(
    main
      .replace(
        /<(script|style|noscript|svg|nav|header|footer|form|template)[^>]*>[^]*?<\/\1>/gi,
        " ",
      )
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return {
    title: title.slice(0, 200),
    description: description.slice(0, 400),
    text,
  };
}

async function fetchCapped(url, { fetcher, resolve, limits }) {
  let current = url;
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const parsed = new URL(current);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw Error("只读取 http/https 链接");
    if (!(await safeHost(parsed.hostname, resolve)))
      throw Error("这个地址不是公开网页");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location");
        if (!next) throw Error("跳转缺少目标");
        current = new URL(next, current).toString();
        continue;
      }
      if (!response.ok) throw Error("网页没有正常返回");
      const type = response.headers.get("content-type") || "";
      if (type && !TEXT_TYPES.test(type)) throw Error("不是网页文字内容");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > limits.maxBytes) throw Error("网页太大");
      const reader = response.body?.getReader?.();
      if (!reader) {
        const text = await response.text();
        if (Buffer.byteLength(text) > limits.maxBytes) throw Error("网页太大");
        return { url: current, type, body: text };
      }
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limits.maxBytes) {
          await reader.cancel().catch(() => {});
          throw Error("网页太大");
        }
        chunks.push(value);
      }
      return {
        url: current,
        type,
        body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"),
      };
    } catch (error) {
      if (error.name === "AbortError") throw Error("网页读取超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw Error("跳转次数太多");
}

const GITHUB_REPO =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export class LinkReader {
  constructor({
    db = null,
    fetcher = fetch,
    resolve = (host) => lookup(host, { all: true, verbatim: true }),
    limits = {},
    now = () => Date.now(),
  } = {}) {
    this.db = db;
    this.fetcher = fetcher;
    this.resolve = resolve;
    this.limits = { ...LINK_LIMITS, ...limits };
    this.now = now;
    this.memory = new Map();
    if (db)
      db.exec(
        "CREATE TABLE IF NOT EXISTS core_link_cache (url TEXT PRIMARY KEY, ok INTEGER NOT NULL, title TEXT, site TEXT, description TEXT, text TEXT, error TEXT, fetched INTEGER NOT NULL)",
      );
  }
  cached(url) {
    const fresh = (row) => row && this.now() - row.fetched < this.limits.ttlMs;
    const hit = this.memory.get(url);
    if (fresh(hit)) return hit;
    const row = this.db
      ?.prepare("SELECT * FROM core_link_cache WHERE url=?")
      .get(url);
    if (fresh(row)) {
      const value = { ...row, ok: !!row.ok };
      this.memory.set(url, value);
      return value;
    }
    return null;
  }
  remember(value) {
    this.memory.set(value.url, value);
    if (this.memory.size > 200)
      this.memory.delete(this.memory.keys().next().value);
    this.db
      ?.prepare(
        "INSERT INTO core_link_cache(url,ok,title,site,description,text,error,fetched) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET ok=excluded.ok,title=excluded.title,site=excluded.site,description=excluded.description,text=excluded.text,error=excluded.error,fetched=excluded.fetched",
      )
      .run(
        value.url,
        value.ok ? 1 : 0,
        value.title || "",
        value.site || "",
        value.description || "",
        value.text || "",
        value.error || "",
        value.fetched,
      );
    return value;
  }
  async read(url) {
    const hit = this.cached(url);
    if (hit) return hit;
    const site = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    try {
      const repo = url.match(GITHUB_REPO);
      if (repo) return this.remember(await this.github(url, repo[1], repo[2]));
      const page = await fetchCapped(url, {
        fetcher: this.fetcher,
        resolve: this.resolve,
        limits: this.limits,
      });
      const html = /html/i.test(page.type) || /^\s*</.test(page.body);
      const parts = html
        ? readable(page.body)
        : { title: "", description: "", text: page.body.trim() };
      return this.remember({
        url,
        ok: true,
        site,
        title: parts.title,
        description: parts.description,
        text: parts.text.slice(0, this.limits.textChars),
        fetched: this.now(),
      });
    } catch (error) {
      return this.remember({
        url,
        ok: false,
        site,
        error: String(error.message || error).slice(0, 120),
        fetched: this.now(),
      });
    }
  }
  async github(url, owner, name) {
    const api = `https://api.github.com/repos/${owner}/${name}`;
    const get = async (target, accept) =>
      fetchCapped(target, {
        fetcher: (u, o) =>
          this.fetcher(u, { ...o, headers: { ...o.headers, Accept: accept } }),
        resolve: this.resolve,
        limits: this.limits,
      });
    const info = JSON.parse(
      (await get(api, "application/vnd.github+json")).body || "{}",
    );
    let readme = "";
    try {
      readme = (await get(`${api}/readme`, "application/vnd.github.raw+json"))
        .body;
    } catch {
      // A repository without a README still has its description.
    }
    return {
      url,
      ok: true,
      site: "github.com",
      title: info.full_name || `${owner}/${name}`,
      description: [
        info.description,
        info.language && `主要语言 ${info.language}`,
        Number.isFinite(info.stargazers_count) &&
          `${info.stargazers_count} star`,
      ]
        .filter(Boolean)
        .join("；"),
      text: readme
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/<[^>]+>/g, " ")
        .slice(0, this.limits.textChars),
      fetched: this.now(),
    };
  }
  // Links in the messages she is reading now: what each page is, in its own
  // words. No extra model call: the title, description and opening of the
  // page are enough for a chat, and keep the turn fast.
  async forMessages(messages) {
    const wanted = [];
    for (const m of messages || [])
      for (const url of linksIn(m.text))
        if (!wanted.some((w) => w.url === url))
          wanted.push({ url, messageId: m.id });
    const picked = wanted.slice(-this.limits.perTurn);
    return Promise.all(
      picked.map(async ({ url, messageId }) => {
        const page = await this.read(url);
        if (!page.ok)
          return { messageId, url, site: page.site, fetched: false };
        return {
          messageId,
          url,
          site: page.site,
          fetched: true,
          title: page.title,
          ...(page.description ? { description: page.description } : {}),
          excerpt: String(page.text || "").slice(0, 1200),
        };
      }),
    );
  }
}
