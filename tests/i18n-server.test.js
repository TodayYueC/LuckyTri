import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";
import {
  LOCALE_HEADER,
  localeOf,
  localizeValue,
  translate,
} from "../server/i18n/index.js";
import { ERRORS, ERROR_PATTERNS } from "../server/i18n/errors.js";
import { LABELS, LABEL_PATTERNS } from "../server/i18n/labels.js";
import { MODEL_LABELS, MODEL_PATTERNS } from "../server/i18n/models.js";
import { DECISIONS, DECISION_PATTERNS } from "../server/i18n/decisions.js";
import { world } from "./helpers/world.js";

const HAN = /[\u3400-\u9fff]/;
const SERVER = fileURLToPath(new URL("../server", import.meta.url));

function sources(dir = SERVER, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "i18n") sources(path, out);
    } else if (name.endsWith(".js"))
      out.push([path, readFileSync(path, "utf8")]);
  }
  return out;
}

// ── the dictionaries themselves ────────────────────────────────────────────

const DICTIONARIES = [
  ["errors", ERRORS, ERROR_PATTERNS],
  ["labels", LABELS, LABEL_PATTERNS],
  ["models", MODEL_LABELS, MODEL_PATTERNS],
  ["decisions", DECISIONS, DECISION_PATTERNS],
];

test("every dictionary entry has English text with no Chinese left in it", () => {
  for (const [name, exact, patterns] of DICTIONARIES) {
    for (const [zh, en] of [...Object.entries(exact), ...patterns]) {
      assert.match(zh, HAN, `${name}: key without Chinese: ${zh}`);
      assert.equal(typeof en, "string", `${name}: ${zh}`);
      assert.ok(en.trim(), `${name}: empty English for ${zh}`);
      assert.doesNotMatch(en, HAN, `${name}: Chinese left in ${zh}`);
      assert.doesNotMatch(
        en,
        /[，。：；？！（）、]/,
        `${name}: full-width punctuation in ${en}`,
      );
    }
  }
});

test("patterns keep the same slots on both sides", () => {
  for (const [name, , patterns] of DICTIONARIES) {
    for (const [zh, en] of patterns) {
      const slots = (text) =>
        [...text.matchAll(/\{(\d)\}/g)]
          .map((m) => m[1])
          .sort()
          .join();
      assert.equal(slots(en), slots(zh), `${name}: ${zh}`);
    }
  }
});

test("a sentence is not defined twice with different English", () => {
  const seen = new Map();
  for (const [name, exact] of DICTIONARIES) {
    for (const [zh, en] of Object.entries(exact)) {
      if (seen.has(zh) && seen.get(zh) !== en)
        assert.fail(`${zh} differs between dictionaries (${name})`);
      seen.set(zh, en);
    }
  }
});

test("no entry outlives the code that wrote it", () => {
  const code = sources()
    .map(([, text]) => text)
    .join("\n");
  const stale = [];
  for (const [name, exact, patterns] of DICTIONARIES) {
    for (const zh of Object.keys(exact))
      if (!code.includes(zh)) stale.push(`${name}: ${zh}`);
    for (const [zh] of patterns) {
      // A pattern is stale when the code writes none of its fixed parts (some
      // parts are chosen by a condition, so one match is enough).
      const fixed = zh
        .split(/\{\d\}/)
        .map((part) => part.trim())
        .filter((part) => HAN.test(part));
      if (!fixed.some((part) => code.includes(part)))
        stale.push(`${name}: ${zh}`);
    }
  }
  assert.deepEqual(stale, []);
});

// ── every error the code can raise has an English sentence ─────────────────

const ERROR_SITES =
  /(?:\berror\s*:\s*|\.error\s*=\s*|\bError\(\s*|\bnew Error\(\s*)(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;

test("every error message the server raises can be shown in English", () => {
  const missing = [];
  const keys = DICTIONARIES.flatMap(([, exact, patterns]) => [
    ...Object.keys(exact),
    ...patterns.map(([zh]) => zh),
  ]);
  const starts = (lead) => keys.some((key) => key.startsWith(lead));
  for (const [path, text] of sources()) {
    for (const [, , literal] of text.matchAll(ERROR_SITES)) {
      if (!HAN.test(literal)) continue;
      // `${value}` stands for what the code puts in; use a plain word for it.
      // A nested template cuts the match short; then only the start can be
      // compared, against the start of an entry.
      const open = literal.lastIndexOf("${");
      if (open >= 0 && literal.indexOf("}", open) < 0) {
        const lead = literal.slice(0, literal.indexOf("${"));
        assert.ok(
          starts(lead),
          `${path}: nothing in the dictionaries starts with "${lead}"`,
        );
        continue;
      }
      const sample = literal
        .replace(/\$\{[^}]*\}/g, "value")
        .replace(/\\n/g, "\n");
      if (HAN.test(translate(sample, "en")))
        missing.push(`${path.split(/[\\/]server[\\/]/).pop()}: ${literal}`);
    }
  }
  assert.deepEqual(missing, []);
});

// ── how a sentence is translated ───────────────────────────────────────────

test("exact sentences, filled patterns and lists", () => {
  assert.equal(translate("请输入管理令牌"), "Enter the admin token");
  assert.equal(translate("3 天前"), "3 days ago");
  assert.equal(translate("1 天前"), "1 day ago");
  assert.equal(translate("退出码 2"), "Exit code 2");
  assert.equal(
    translate("好几天前知道的"),
    "learned several days ago",
    "values inside a pattern are translated too",
  );
  assert.equal(
    translate("扫了一眼（有人在叫我，攒了一些消息），没细看"),
    "Glanced over it (Someone was calling me, Some messages piled up); did not look closely",
  );
  assert.equal(
    translate("已配置。"),
    "Configured.",
    "a closing full stop is carried over",
  );
});

test("what is not the system's own wording is left alone", () => {
  assert.equal(
    translate("今天心情不错，想出去走走"),
    "今天心情不错，想出去走走",
  );
  assert.equal(translate("今天想去海边"), "今天想去海边");
  assert.equal(translate("plain English stays"), "plain English stays");
  assert.equal(
    translate("读了《红楼梦》，没多想"),
    "Read “红楼梦” without thinking much of it",
  );
  assert.equal(
    translate("刚才", "zh"),
    "刚才",
    "Chinese requests are never changed",
  );
});

test("message text is never translated, even when it matches", () => {
  const body = {
    ok: true,
    label: "安静",
    messages: [
      { content: "安静", text: "喜欢", nickname: "刚才", reason: "刚才" },
    ],
    list: ["喜欢", 3, null],
  };
  assert.deepEqual(localizeValue(body, "en"), {
    ok: true,
    label: "Quiet",
    messages: [
      { content: "安静", text: "喜欢", nickname: "刚才", reason: "just now" },
    ],
    list: ["Likes", 3, null],
  });
  assert.equal(localizeValue(body, "zh"), body, "Chinese passes through as is");
});

test("the language comes from one header and defaults to Chinese", () => {
  const ask = (value) =>
    localeOf({
      headers: value === undefined ? {} : { [LOCALE_HEADER]: value },
    });
  assert.equal(ask(undefined), "zh");
  assert.equal(ask("zh"), "zh");
  assert.equal(ask("en"), "en");
  assert.equal(ask("EN-us"), "en");
  assert.equal(ask("fr"), "zh");
  assert.equal(ask(""), "zh");
});

// ── on the wire ────────────────────────────────────────────────────────────

async function serve(w) {
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }), shutdown() {} },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, locale, headers } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(locale ? { "X-LuckyTri-Locale": locale } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => strings(item, out));
  return out;
}

test("the API answers in the language the page asks for", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    delete process.env.ADMIN_TOKEN;
    await api.close();
    w.close();
  });

  const zh = (await api.call("GET", "/api/state")).body;
  const en = (await api.call("GET", "/api/state", { locale: "en" })).body;
  assert.ok(zh.readiness.checks.some((check) => HAN.test(check.name)));
  assert.deepEqual(
    strings(en.readiness).filter((text) => HAN.test(text)),
    [],
    "the readiness steps are fully English",
  );
  assert.equal(en.readiness.checks.length, zh.readiness.checks.length);
  assert.deepEqual(
    en.readiness.checks.map((check) => check.id),
    zh.readiness.checks.map((check) => check.id),
    "ids and codes do not change with the language",
  );

  const bad = await api.call("POST", "/api/settings", {
    locale: "en",
    body: [1],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "Submit a JSON object");
  const badZh = await api.call("POST", "/api/settings", { body: [1] });
  assert.equal(badZh.body.error, "请提交 JSON 对象");

  process.env.ADMIN_TOKEN = "t0ken";
  const denied = await api.call("GET", "/api/state", { locale: "en" });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error, "Enter the admin token");
});
