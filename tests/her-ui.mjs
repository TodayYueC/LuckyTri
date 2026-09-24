import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import "./awake.mjs";
import { createApp } from "../server/app.js";
import { world, MINUTE } from "./helpers/world.js";

const w = world({ start: "2026-09-22T09:00:00+08:00" });
w.open("group:12345", "春日聊天室");
w.open("private:10001", "阿明");
const say = (s, u, t) =>
  w.say(s, u, t, { name: u === "10001" ? "阿明" : "小红" });
w.answers.turn = (data) => {
  const ctx = data.context;
  const batch = ctx.messages.filter((m) => ctx.batchIds.includes(m.id));
  const t = batch.at(-1);
  return {
    appraisal: `${t.name}在叫我`,
    feelings: [
      { feeling: "开心", intensity: 0.4, valence: 0.5, cause: [t.id] },
    ],
    bonds: [
      {
        userId: t.speaker,
        change: "warmer",
        why: "主动找我",
        evidence: [t.id],
      },
    ],
    choice: "speak",
    reason: `回应${t.name}`,
    targetMessageIds: [t.id],
    bubbles: ["在呢"],
  };
};
w.answers.reflection = (data) => {
  const m = data.experiences.flatMap((e) => e.messages).find((x) => x.userId);
  return {
    thought: {
      kind: "unfinished",
      content: "阿明在准备面试，结果还不知道",
      sources: [m.seq],
    },
    self: [
      {
        action: "new",
        kind: "care",
        content: "我有点在意阿明的面试",
        sources: [m.seq],
      },
      {
        action: "new",
        kind: "interest",
        content: "我喜欢听大家说各自在忙什么",
      },
    ],
    faces: [
      { session: "group:12345", role: "偶尔接话的那个", sources: [m.seq] },
    ],
    mood: { feeling: "安静", intensity: 0.2, valence: 0.1 },
  };
};
w.answers.daily = (data) => ({
  diary: "今天阿明说要去面试，我有点替他紧张。",
  mood: "平静",
  compare: data.yesterday ? "比昨天更在意大家了" : "今天是开始",
  self: [],
  chapter: null,
});
await w.hear(
  "group:12345",
  say("group:12345", "10001", "LuckyBot，我明天面试"),
);
for (let i = 0; i < 6; i++) {
  say("group:12345", i % 2 ? "10001" : "10002", `准备第${i}题`);
  w.advance(MINUTE);
}
await w.hear("private:10001", say("private:10001", "10001", "紧张"));
w.at("2026-09-22T11:00:00+08:00");
assert.equal((await w.life.tick()).status, "written");
w.at("2026-09-22T23:30:00+08:00");
assert.equal((await w.life.tick()).status, "written");

const server = createApp({
  store: w.store,
  chatSystem: w.system,
  life: w.life,
  runtime: { connection: () => ({ online: false }), shutdown: () => {} },
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (dialog) => dialog.accept("界面测试"));
const tab = async (id) => {
  await page.locator(`[data-her=${id}]`).click();
  await page.waitForTimeout(300);
};
try {
  await page.goto(base + "/app/#time");
  await page.locator(".her-studio").waitFor();
  assert.equal(
    await page.evaluate(() => location.hash),
    "#her",
    "旧的时间页落到「她」",
  );
  assert.match(await page.locator(".her-intro h2").innerText(), /醒着/);
  assert.ok((await page.locator(".choice-list article").count()) >= 2);

  await tab("self");
  assert.equal(await page.locator(".thread").count(), 2);
  await page
    .locator(".thread")
    .first()
    .getByRole("button", { name: /个版本/ })
    .click();
  await page.locator(".thread-history").first().waitFor();
  await page
    .locator(".thread")
    .first()
    .getByRole("button", { name: "撤销" })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".thread").length === 1,
  );
  assert.ok((await page.locator("text=你撤销过的").count()) === 1);

  await tab("bonds");
  await page.locator("button.person-card").filter({ hasText: "阿明" }).click();
  await page.getByText("更亲近了一点").first().waitFor();
  assert.match(
    await page.locator(".face-card").first().innerText(),
    /偶尔接话的那个/,
  );

  await tab("life");
  await page.locator(".diary-entry").first().waitFor();
  assert.match(
    await page.locator(".diary-entry").first().innerText(),
    /今天是开始/,
  );
  await page.getByRole("button", { name: "那天的她 ↗" }).first().click();
  await page.getByText("这是她留下快照的第一天").waitFor();
  await page
    .locator(".her-note")
    .first()
    .getByRole("button", { name: "不再参与她的思考" })
    .click();
  await page.locator(".her-note.muted").first().waitFor();
  assert.ok((await page.locator(".run-list article").count()) >= 2);

  await tab("nature");
  const version = w.mind.nature.version();
  await page.locator("#natureForm [name=sarcasm]").fill("12");
  await page.locator("#natureForm .primary").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent?.includes("天性已保存"),
  );
  assert.equal(w.mind.nature.version(), version + 1);
  assert.equal(w.mind.nature.current().sarcasm, 12);
  await page.getByLabel(/允许她主动说话/).check();
  await page.getByRole("button", { name: /保存她的日子/ }).click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent?.includes("新设置"),
  );
  assert.equal(w.life.settings().proactive, true);
  const before = w.store.db
    .prepare("SELECT COUNT(*) n FROM mind_choices")
    .get().n;
  await page.locator("#previewForm [name=text]").fill("今天好累啊");
  await page.locator("#previewForm button.primary").click();
  await page.locator("#previewMessages .preview-bubble.bot").waitFor();
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_choices").get().n,
    before,
    "试聊不写入她的心智",
  );

  await mkdir("workspace/ui-review", { recursive: true });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const id of ["now", "self", "bonds", "life", "nature"]) {
      await tab(id);
      await page.screenshot({
        path: `workspace/ui-review/her-${id}-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
        false,
        `${id} overflow at ${width}`,
      );
    }
  }
  const layout = await page.evaluate(() => ({
    outer: getComputedStyle(document.querySelector(".studio")).overflowY,
    page: getComputedStyle(document.querySelector(".page-her")).overflowY,
  }));
  assert.deepEqual(
    layout,
    { outer: "visible", page: "visible" },
    "「她」按文档滚动",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: her now, self revocation, bonds and faces, diary and day view, journal, nature, life settings, preview, responsive layout",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  w.close();
}
