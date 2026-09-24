import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import "./awake.mjs";
import { livedWorld, serve } from "./helpers/ta-world.mjs";

const w = await livedWorld();

// `node tests/ta-ui.mjs --serve` keeps the lived-in world open for a look.
if (process.argv.includes("--serve")) {
  const { base } = await serve(w, Number(process.env.UI_PREVIEW_PORT || 3299));
  console.log(`TA 的小世界：${base}/app/`);
} else {
  await run();
}

async function run() {
  const { base, close } = await serve(w);
  const browser = await chromium.launch({
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const choices = () =>
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_choices").get().n;
  const mood = () => page.evaluate(() => document.documentElement.dataset.mood);
  const open = async (hash) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.locator(`.page-${hash.slice(1).split("/")[0]}`).waitFor();
    await page.waitForTimeout(300);
  };
  const confirm = async (text) => {
    if (text !== undefined) await page.locator(".dialog input").fill(text);
    await page.locator(".dialog-confirm").click();
    await page.locator(".dialog").waitFor({ state: "detached" });
  };
  try {
    for (const [from, to] of [
      ["time", "#now"],
      ["her", "#now"],
      ["overview", "#now"],
      ["character", "#now"],
      ["live", "#chats"],
      ["spaces", "#chats/settings"],
      ["lab", "#chats/replay"],
      ["knowledge", "#memory"],
      ["models", "#system/models"],
      ["connect", "#system/connect"],
    ]) {
      await page.goto(`${base}/app/?${from}#${from}`);
      await page.locator(".shell").waitFor();
      assert.equal(
        await page.evaluate(() => location.hash),
        to,
        `旧链接 #${from} 跳到 ${to}`,
      );
    }

    await page.goto(`${base}/app/#now`);
    await page.locator(".page-now .mood-word").waitFor();
    assert.match(await page.locator(".page-now .lede").innerText(), /醒着/);
    await page.locator(".today .timeline li").first().waitFor();
    assert.ok(
      (await page.locator(".today .timeline li").count()) >= 3,
      "今天的 TA 按时间排在一起",
    );
    assert.match(await page.locator(".note.ahead").innerText(), /面试/);

    // The whole studio follows TA's mood.
    w.mind.affect.feel({
      feeling: "超开心",
      intensity: 1,
      valence: 0.9,
      arousal: 0.8,
      cause: "阿明面试过了",
      time: w.now(),
    });
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.mood === "bright",
    );
    assert.match(
      await page.locator(".page-now .mood-word").innerText(),
      /超开心/,
    );

    await page.locator(".theme-toggle").click();
    await page.locator("[data-theme-choice=sweet]").click();
    assert.equal(await mood(), "sweet");
    await page.reload();
    await page.locator(".shell").waitFor();
    assert.equal(await mood(), "sweet", "固定的主题刷新后仍然保留");
    await page.locator(".theme-toggle").click();
    await page.locator("[data-theme-choice=auto]").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.mood === "bright",
    );

    await page.getByRole("button", { name: "减少动画" }).first().click();
    assert.equal(
      await page.locator(".sky").getAttribute("data-particles"),
      "off",
      "减少动画后粒子关闭",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.motion),
      "quiet",
    );
    await page.getByRole("button", { name: "开启灵动效果" }).first().click();
    assert.equal(
      await page.locator(".sky").getAttribute("data-particles"),
      "sparkle",
    );

    // Poking TA is only an animation with a canned line.
    const before = choices();
    await page.locator(".page-now .stage .ta-orb").click();
    await page.locator(".page-now .stage .orb-say").waitFor();

    await open("#heart");
    await page.locator(".companion-talk").click();
    await page.locator(".ta-drawer input[name=text]").fill("今天好累啊");
    await page.locator(".ta-drawer button.primary").click();
    await page.locator(".ta-drawer .preview-bubble.bot").waitFor();
    assert.equal(choices(), before, "小 TA 的聊天是试聊，不写入心智");
    await page
      .locator(".ta-drawer")
      .getByRole("button", { name: "收起聊天" })
      .click();

    await page.locator(".star").first().waitFor();
    assert.equal(await page.locator(".star").count(), 2);
    await page.locator(".star").first().click();
    await page.locator(".thread-sheet .versions li").first().waitFor();
    await page.locator("[data-revoke-thread]").click();
    await confirm("界面测试");
    await page.waitForFunction(
      () => document.querySelectorAll(".star").length === 1,
    );
    assert.match(
      await page.locator(".set-aside").innerText(),
      /你撤销过的 · 1/,
    );

    await open("#heart/notes");
    await page.locator(".note-card").first().waitFor();
    await page
      .locator(".note-card")
      .first()
      .getByRole("button", { name: "不再参与 TA 的思考" })
      .click();
    await page.locator(".note-card.muted").first().waitFor();

    await open("#people");
    await page.locator(".person-node[data-person='10001']").click();
    await page
      .locator(".person-sheet")
      .getByText("阿明在准备一家游戏公司的面试")
      .waitFor();
    const changes = await page
      .locator(".person-sheet [data-revoke-change]")
      .count();
    assert.ok(changes >= 2);
    await page.locator(".person-sheet [data-revoke-change]").first().click();
    await confirm();
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll(".person-sheet [data-revoke-change]")
          .length === n,
      changes - 1,
    );
    await page.locator(".sheet-close").click();
    assert.match(
      await page.locator(".face-card").first().innerText(),
      /偶尔接话的那个/,
    );

    await open("#life");
    await page.locator(".diary-page").waitFor();
    assert.match(
      await page.locator(".diary-page").innerText(),
      /比昨天更在意大家了/,
    );
    await page.locator(".diary-day[data-day='2026-09-20']").click();
    await page.getByRole("button", { name: "那天的 TA" }).click();
    await page.getByText("这是 TA 留下快照的第一天").waitFor();
    await page.getByRole("tab", { name: /约定与期待/ }).click();
    await page.getByRole("tab", { name: /清单/ }).click();
    const promise = page
      .locator(".ahead-item")
      .filter({ hasText: "周末陪小红聊聊新学期" });
    await promise.getByRole("button", { name: "撤销" }).click();
    await confirm("界面测试");
    await promise.getByText("已撤销").waitFor();
    await page.locator(".runs summary").click();
    assert.ok((await page.locator(".run-row").count()) >= 2);

    await open("#nature");
    const version = w.mind.nature.version();
    await page.locator("[data-trait=warmth]").evaluate((el) => {
      el.value = "100";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document
        .querySelector(".preview-orb svg")
        ?.style.filter.includes("-28deg"),
    );
    await page.locator("#natureForm [name=sarcasm]").fill("60");
    await page.locator(".preview-orb .brows").waitFor();
    await page.locator("#natureForm .primary").click();
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent?.includes("天性已保存"),
    );
    assert.equal(w.mind.nature.version(), version + 1);
    assert.equal(w.mind.nature.current().sarcasm, 60);
    assert.equal(w.mind.nature.current().warmth, 100);
    await page.getByLabel(/允许 TA 主动说话/).check();
    await page.getByRole("button", { name: "保存 TA 的日子" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#toast")?.textContent?.includes("新设置"),
    );
    assert.equal(w.life.settings().proactive, true);
    const quiet = choices();
    await page.locator("#previewForm [name=text]").fill("今天好累啊");
    await page.locator("#previewForm button.primary").click();
    await page.locator("#previewMessages .preview-bubble.bot").waitFor();
    assert.equal(choices(), quiet, "试聊不写入 TA 的心智");

    await mkdir("workspace/ui-review", { recursive: true });
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const area of [
        "now",
        "chats",
        "heart",
        "people",
        "life",
        "memory",
        "nature",
        "system",
      ]) {
        await open("#" + area);
        await page.screenshot({
          path: `workspace/ui-review/ta-${area}-${width}.png`,
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          ),
          false,
          `${area} overflow at ${width}`,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    // At night the studio falls asleep with TA.
    const nature = w.mind.nature.current();
    w.mind.nature.save(
      { ...nature, rhythm: { enabled: true, sleep: "02:00", wake: "08:00" } },
      "界面测试",
    );
    w.at("2026-09-23T03:00:00+08:00");
    await open("#now");
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.mood === "night",
    );
    await page.locator(".dock-ta .ta-orb[data-activity=asleep]").waitFor();
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
      "dark",
    );

    assert.deepEqual(errors, []);
    console.log(
      "PASS: legacy links, mood theme and pinning, reduced motion, companion preview, star revoke, notes, person sheet, diary and day view, anticipations, nature preview and save, life settings, responsive layout, night",
    );
  } finally {
    await browser.close();
    await close();
    w.close();
  }
}
