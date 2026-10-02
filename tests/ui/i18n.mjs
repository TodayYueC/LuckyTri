import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import "../helpers/awake.mjs";
import { livedWorld, serve } from "../helpers/ta-world.mjs";

// The English page is checked against the data behind it: every Chinese run on
// screen must come from something stored (her words, a person's name, a chat
// line). Anything else is interface text that was never translated.
const w = await livedWorld();
const server = await serve(w);
const stored = [];
for (const { name } of w.store.db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()) {
  for (const row of w.store.db.prepare(`SELECT * FROM "${name}"`).all())
    stored.push(JSON.stringify(row));
}
const corpus = stored.join("\n");
assert.ok(
  corpus.length > 1000,
  "the fixture has stored content to compare with",
);

const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  headless: true,
});

const PAGES = [
  "now",
  "heart",
  "heart/notes",
  "people",
  "life",
  "life/diary",
  "time",
  "chats",
  "chats/settings",
  "chats/replay",
  "memory",
  "memory/shelf",
  "nature",
  "system",
  "system/models",
  "system/connect",
  "system/runtime",
];

async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("[i18n]"))
      problems.push(message.text());
  });
  return { context, page, problems };
}

// Chinese runs on screen that nothing stored explains.
async function untranslated(page) {
  const runs = await page.evaluate(() => {
    const HAN = /[\u3400-\u9fff]+/g;
    const out = [];
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const exempt = (el) => el.closest("[data-own], [lang]");
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || exempt(el) || !visible(el)) continue;
      for (const run of node.nodeValue.match(HAN) || []) out.push(run);
    }
    for (const el of document.querySelectorAll(
      "[title],[aria-label],[placeholder],[alt]",
    )) {
      if (exempt(el)) continue;
      for (const attr of ["title", "aria-label", "placeholder", "alt"])
        for (const run of (el.getAttribute(attr) || "").match(HAN) || [])
          out.push(run);
    }
    return out;
  });
  return [...new Set(runs)].filter((run) => !corpus.includes(run));
}

try {
  // ── English: nothing the interface says is left in Chinese ───────────────
  {
    const { context, page, problems } = await newPage();
    await context.addInitScript(() =>
      localStorage.setItem("luckyLocale", "en"),
    );
    const sent = new Set();
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      // The change stream is an EventSource, which cannot carry headers; it
      // sends no wording, only "something changed".
      if (pathname.startsWith("/api/") && pathname !== "/api/core/stream")
        sent.add(request.headers()["x-luckytri-locale"]);
    });
    const left = new Map();
    const collect = async (where) => {
      for (const run of await untranslated(page))
        if (!left.has(run)) left.set(run, where);
    };
    for (const hash of PAGES) {
      await page.goto(`${server.base}/app/#${hash}`);
      await page.locator(".shell").waitFor();
      await page.waitForTimeout(500);
      await collect(hash);
      const tabs = page.locator("[role=tab], .seg:not(.locale-switch) button");
      for (let i = 0; i < (await tabs.count()); i++) {
        try {
          await tabs.nth(i).click({ timeout: 1500 });
        } catch {
          continue; // not clickable right now; the next page visits it again
        }
        await page.waitForTimeout(250);
        await collect(`${hash} [${i}]`);
      }
    }
    assert.deepEqual(
      [...left].map(([run, where]) => `${where}: ${run}`),
      [],
      "Chinese on the English pages that is not stored content",
    );
    assert.deepEqual([...sent], ["en"], "every request names the language");
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    assert.deepEqual(problems, []);
    await context.close();
  }

  // ── default, switching, and remembering the choice ───────────────────────
  {
    // A browser that speaks English still opens in Chinese until asked.
    const { context, page, problems } = await newPage({ locale: "en-US" });
    await page.goto(`${server.base}/app/#now`);
    await page.locator(".shell").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "zh-CN",
    );
    assert.equal(
      await page
        .locator('#locale [data-locale="zh"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator('.dock-link[data-page="heart"]').waitFor();
    assert.match(
      await page.locator(".dock-link[data-page=heart]").innerText(),
      /[\u3400-\u9fff]/,
    );

    await page.locator('#locale [data-locale="en"]').click();
    await page.waitForFunction(() => document.documentElement.lang === "en");
    assert.doesNotMatch(
      await page.locator(".dock-link[data-page=heart]").innerText(),
      /[\u3400-\u9fff]/,
      "the navigation changes without a reload",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("luckyLocale")),
      "en",
    );

    await page.reload();
    await page.locator(".shell").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    assert.match(
      await page.locator("a[href*='guide']").first().getAttribute("href"),
      /guide\.en\.html$/,
      "the tutorial opens in the page's language",
    );

    await page.locator('#locale [data-locale="zh"]').click();
    await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    await page.reload();
    await page.locator(".shell").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "zh-CN",
    );
    assert.match(
      await page.locator("a[href*='guide']").first().getAttribute("href"),
      /guide\.html$/,
    );
    assert.deepEqual(problems, []);
    await context.close();
  }

  // ── English text fits at phone, tablet and desktop widths ────────────────
  for (const width of [390, 820, 1440]) {
    const { context, page } = await newPage({
      viewport: { width, height: 900 },
    });
    await context.addInitScript(() =>
      localStorage.setItem("luckyLocale", "en"),
    );
    for (const hash of ["now", "chats", "time", "memory", "system/connect"]) {
      await page.goto(`${server.base}/app/#${hash}`);
      await page.locator(".shell").waitFor();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        topbar: (() => {
          const bar = document.querySelector(".topbar");
          return bar ? bar.scrollWidth - bar.clientWidth : 0;
        })(),
      }));
      assert.ok(
        overflow.page <= 1,
        `${hash} @${width}: page is ${overflow.page}px too wide`,
      );
      assert.ok(
        overflow.topbar <= 1,
        `${hash} @${width}: top bar is ${overflow.topbar}px too wide`,
      );
      const switchBox = await page.locator("#locale").boundingBox();
      assert.ok(
        switchBox && switchBox.x >= 0 && switchBox.x + switchBox.width <= width,
        `${hash} @${width}: the language switch stays on screen`,
      );
    }
    await context.close();
  }
  console.log("English interface checks passed");
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
