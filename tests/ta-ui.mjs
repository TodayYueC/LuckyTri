import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import "./awake.mjs";
import { livedWorld, serve } from "./helpers/ta-world.mjs";

const w = await livedWorld();
// Dense real-world layouts: many people and a migrated multi-page persona.
for (let i = 0; i < 39; i++) {
  w.store.db
    .prepare(
      "INSERT INTO mind_people(user_id,name,first_seen,last_seen,sessions) VALUES (?,?,?,?,?)",
    )
    .run(`layout-${i}`, `测试群友 ${i}`, w.now(), w.now(), '["group:12345"]');
}
w.store.db
  .prepare("UPDATE mind_faces SET content=? WHERE session_id='group:12345'")
  .run(
    "这是一段很长的旧版人格，要保留完整内容，但不能把卡片拉成细长的一列。".repeat(
      100,
    ),
  );

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
    await page.locator(".presence-dock .mood-word").waitFor();
    assert.equal(
      await page.locator(".page-now .ready").count(),
      0,
      "首页不再出现接入检查清单",
    );
    assert.match(
      await page.locator(".presence-dock .lede").innerText(),
      /醒着/,
    );
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
      await page.locator(".presence-dock .mood-word").innerText(),
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

    // Poking TA is only an animation with a canned line. The home hides
    // the corner orb, so this happens once another page is open.
    await open("#heart");
    const before = choices();
    await page.locator(".companion-dock .ta-orb").click();
    await page.locator(".companion-dock .orb-say").waitFor();
    await page.locator(".companion-talk").click();
    const orb = await page.locator(".drawer-head .ta-orb").boundingBox();
    const title = await page.locator(".drawer-title").boundingBox();
    assert.ok(
      orb.width <= 43 && orb.x + orb.width <= title.x,
      "试聊头像不拉伸也不遮挡标题",
    );
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
    const peopleBoxes = await page
      .locator(".person-node")
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return {
            id: n.dataset.person,
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          };
        }),
      );
    assert.ok(peopleBoxes.length > 0 && peopleBoxes.length <= 24);
    assert.ok(peopleBoxes.some((n) => n.id === "10001"));
    for (let i = 0; i < peopleBoxes.length; i++) {
      for (let j = i + 1; j < peopleBoxes.length; j++) {
        const a = peopleBoxes[i];
        const b = peopleBoxes[j];
        const overlap =
          a.x < b.x + b.w - 1 &&
          a.x + a.w - 1 > b.x &&
          a.y < b.y + b.h - 1 &&
          a.y + a.h - 1 > b.y;
        assert.equal(overlap, false, `${a.id} 和 ${b.id} 叠在一起`);
      }
    }
    assert.match(await page.locator(".galaxy").innerText(), /越熟悉离 TA 越近/);
    await page.locator(".person-node[data-person='10001']").click();
    await page
      .locator(".person-sheet")
      .getByText("阿明在准备一家游戏公司的面试")
      .waitFor();
    const meeting = page
      .locator(".person-sheet li")
      .filter({ hasText: "阿明的面试让我挂心" });
    await meeting.waitFor();
    await meeting.locator("[data-revoke-meeting]").click();
    await confirm();
    await page
      .locator(".person-sheet")
      .getByText("阿明的面试让我挂心")
      .waitFor({ state: "detached" });
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
    assert.ok(
      (await page.locator(".face-card").first().boundingBox()).height < 480,
      "长人格不会撑坏卡片",
    );
    await page
      .locator(".face-card")
      .first()
      .getByRole("button", { name: /查看完整面貌/ })
      .click();
    assert.ok(
      (await page.locator(".face-full").innerText()).length > 2000,
      "详情保留完整长文本",
    );
    await page.locator(".sheet-close").click();

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

    // At night the studio keeps the soft glass palette while TA falls asleep.
    // The two nature edits are already used, so this only turns the clock on.
    const row = w.mind.db
      .prepare(
        "SELECT version, value FROM mind_nature ORDER BY version DESC LIMIT 1",
      )
      .get();
    const value = JSON.parse(row.value);
    value.rhythm = {
      ...value.rhythm,
      enabled: true,
      sleep: "02:00",
      wake: "08:00",
    };
    w.mind.db
      .prepare("UPDATE mind_nature SET value=? WHERE version=?")
      .run(JSON.stringify(value), row.version);
    w.at("2026-09-23T03:00:00+08:00");
    await open("#now");
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.mood === "night",
    );
    await page
      .locator(".presence-dock .activity-chip[data-activity=asleep]")
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
      "light",
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
