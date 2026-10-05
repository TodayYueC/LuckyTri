import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "../helpers/awake.mjs";
import { world } from "../helpers/world.js";
import { serve } from "../helpers/ta-world.mjs";
import { VERSION } from "../../server/version.js";

const w = world();
w.open("group:1", "星空聊天");
w.open("group:2", "旧群聊天室");
w.store.db
  .prepare(
    "INSERT INTO mind_faces(id,session_id,created,content,sources,origin) VALUES ('ui-only-legacy','group:2',?,?,'[]','migration')",
  )
  .run(w.now(), w.mind.nature.current().base);
const m = w.say("group:1", "7", "今天想聊哪颗星星");
assert.ok(
  w.mind.faces.propose(
    {
      session: "group:1",
      changes: [
        {
          action: "add",
          kind: "wish",
          content: "我想和大家一起聊星星",
          why: "刚刚的问题让我想听听大家的故事",
          sources: [m.seq],
        },
        {
          action: "add",
          kind: "question",
          content: "我还在想大家最喜欢哪片夜空",
          why: "这是我自己想继续聊的方向",
          sources: [m.seq],
        },
      ],
    },
    { time: w.now() },
  ).id,
);
w.mind.nature.save(w.mind.nature.current(), "第二次测试修改");
w.mind.nature.grantEdit(
  "ui-one-edit",
  "one extra edit in the isolated UI fixture",
);
const server = await serve(w);
const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  headless: true,
});
mkdirSync("workspace/ui-review", { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let checks = 0,
    status = "available";
  await page.route("**/api/system/update", (route) =>
    route.fulfill({
      json: {
        current: VERSION,
        latest: null,
        checkedAt: null,
        status: "unchecked",
        installation: "source",
        npmUrl: "https://www.npmjs.com/package/luckytri",
        releaseUrl: "https://github.com/TodayYueC/LuckyTri/releases",
      },
    }),
  );
  await page.route("**/api/system/update/check", async (route) => {
    checks++;
    assert.equal(route.request().method(), "POST");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      json: {
        current: VERSION,
        latest: "1.0.4",
        checkedAt: Date.now(),
        status,
        error: status === "unavailable" ? "offline" : "",
        installation: "source",
        npmUrl: "https://www.npmjs.com/package/luckytri",
        releaseUrl: "https://github.com/TodayYueC/LuckyTri/releases",
      },
    });
  });
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(server.base + "/#people");
    const card = page.locator(".face-card").first();
    await card.waitFor();
    assert.match(await card.innerText(), /我想和大家一起聊星星/);
    assert.doesNotMatch(await card.innerText(), /角色|想成为|不靠模仿/);
    await card.getByRole("button", { name: /查看想法与变化/ }).click();
    await page.locator(".sheet-layer .place-notes").waitFor();
    assert.match(
      await page.locator(".sheet-layer").innerText(),
      /刚刚的问题让我想听听大家的故事/,
    );
    await page.locator(".sheet-close").click();
    const oldCard = page
      .locator(".face-card")
      .filter({ hasText: "旧群聊天室" });
    assert.doesNotMatch(await oldCard.innerText(), /不靠模仿/);
    await oldCard.getByRole("button", { name: /查看想法与变化/ }).click();
    await page.locator(".legacy-face summary").waitFor();
    await page.locator(".legacy-face summary").click();
    assert.match(
      await page.locator(".legacy-face .face-full").innerText(),
      /不靠模仿/,
    );
    await page.locator(".sheet-close").click();
    await page.screenshot({
      path: `workspace/ui-review/place-notes-${width}.png`,
      fullPage: true,
    });
    const before = checks;
    await page.goto(server.base + "/#system/runtime");
    await page.locator(".update-settings").waitFor();
    await page.getByRole("button", { name: "检查更新", exact: true }).waitFor();
    assert.equal(
      checks,
      before,
      "opening settings does not contact the registry",
    );
    status = "available";
    await page.getByRole("button", { name: "检查更新", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "正在检查…", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .locator(".update-settings")
      .getByText("有新版本可用", { exact: true })
      .waitFor();
    assert.equal(checks, before + 1);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `no overflow at ${width}px`,
    );
    await page.locator(".update-settings").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `workspace/ui-review/updates-${width}.png`,
      fullPage: true,
    });
  }
  status = "unavailable";
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.locator(".update-settings [role=alert]").waitFor();
  assert.match(
    await page.locator(".version-state").innerText(),
    /暂时无法检查/,
  );
  await page.goto(server.base + "/#nature");
  await page.locator("#natureForm").waitFor();
  assert.match(await page.locator("#natureForm").innerText(), /还可以改 1 次/);
  assert.equal(
    await page.locator(".nature-fields").evaluate((field) => field.disabled),
    false,
  );
  await page.locator("#natureForm input[name=name]").fill("测试星星");
  await page
    .locator("#natureForm")
    .getByRole("button", { name: "保存天性", exact: true })
    .click();
  await page
    .locator("#natureForm")
    .getByRole("button", { name: "已交给 TA", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".nature-fields").evaluate((field) => field.disabled),
    true,
  );
  assert.equal(w.mind.nature.editAllowance().left, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local thoughts, reasons/history, manual cached update UI, offline state, four viewport widths and one real fixture edit grant",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
