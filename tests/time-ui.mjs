import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "./awake.mjs";
import { world, MINUTE } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
const w = world();
w.open("private:10001", "阿明");
const said = w.say("private:10001", "10001", "想看月光小说");
const task = w.mind.time.tasks.add({
  title: "写月光短篇",
  activity: "write",
  kind: "promise",
  subject: "10001",
  session: "private:10001",
  sources: [said.seq],
  why: "想给阿明讲一个自己的故事",
}).id;
w.answers.reflection = {
  done: false,
  title: "月光之门",
  content: "第一段：月光照到门上。",
  summary: "找到门",
  next: "推门",
};
await w.life.activities.run();
for (let n = 0; n < 5; n++) {
  w.advance(MINUTE);
  w.mind.time.tick();
}
w.answers.reflection = {
  done: true,
  title: "月光之门",
  content: "第二段：她推开了门。",
  summary: "门后的世界",
};
await w.life.activities.run();
const projectId = w.mind.time.tasks.get(task).project_id;
w.mind.time.works.suggest(projectId, { idea: "写下下一篇" });
w.answers.reflection = {
  done: false,
  title: "第二篇",
  content: "第三段：她见到了晨光。",
  summary: "新的开头",
};
await w.life.activities.run();
// The library exposes the actual origin of fallback material without a fake link.
w.answers.reflection = {
  sufficient: true,
  materials: [
    {
      title: "月光资料整理",
      content: "模型已有知识整理的月光背景资料，具体信息未经联网核验。".repeat(
        8,
      ),
      uncertainty: "仅供背景参考。",
    },
  ],
};
await w.mind.time.search.query("月光 创作背景", { projectId });
const ownSource = w.say("private:10001", "10001", "还想折腾点什么");
const ownTask = w.mind.time.tasks.add({
  title: "想一想窗外的雨",
  activity: "think",
  kind: "plan",
  sources: [ownSource.seq],
}).id;
const server = await serve(w),
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
try {
  mkdirSync("workspace/ui-review", { recursive: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let bodies = 0;
  page.on("request", (r) => {
    if (/\/api\/mind\/time\/works\/[\w-]+/.test(new URL(r.url()).pathname))
      bodies++;
  });
  await page.goto(server.base + "#time");
  await page
    .getByRole("heading", { name: "今日时间表", exact: true })
    .waitFor();
  assert.ok(await page.locator(".day-agenda .agenda-block.plan").count());
  assert.match(await page.locator(".day-agenda").innerText(), /自己的安排/);
  await page.getByRole("button", { name: "全天", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "全天", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      `时间表 ${width} 不应横向溢出`,
    );
    const sizes = await page
      .locator(".agenda-axis time")
      .evaluateAll((elements) =>
        elements
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          })),
      );
    assert.ok(
      sizes.every((s, i) => !i || sizes[i - 1].right <= s.left + 1),
      `时间刻度 ${width} 不应重叠`,
    );
    await page
      .locator(".day-agenda")
      .screenshot({ path: `workspace/ui-review/time-agenda-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".agenda-itinerary button")
    .filter({ hasText: "想一想窗外的雨" })
    .first()
    .click();
  await page.locator('[data-task="' + ownTask + '"]').waitFor();
  assert.equal(
    await page.locator(".time-task").count(),
    1,
    "时间表打开所选事项",
  );
  await page.getByRole("button", { name: "查看全部待办", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".time-task").length > 1,
  );
  await page.getByRole("tab", { name: "今日", exact: true }).click();
  const queued = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/mind/time/care" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "空下来整理一下约定", exact: true })
    .click();
  await queued;
  assert.equal(w.life.ownDay.status().queued, true);
  await page
    .getByRole("button", { name: "已记下，空下来时整理", exact: true })
    .waitFor();
  w.mind.time.tasks.control(ownTask, {
    action: "abandon",
    reason: "时间表测试场景结束",
  });
  await page.goto(server.base + "#time/works");
  await page.locator(".work-card").first().waitFor();
  assert.equal(bodies, 0, "作品列表不请求正文");
  await page.locator(".work-card").filter({ hasText: "月光之门" }).click();
  await page.locator(".work-body").waitFor();
  assert.match(await page.locator(".work-body").innerText(), /第二段/);
  await page.locator(".sheet select").selectOption("1");
  await page.waitForFunction(
    () =>
      document.querySelector(".work-body")?.textContent.includes("第一段") &&
      !document.querySelector(".work-body")?.textContent.includes("第二段"),
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出正文" }).click();
  assert.match((await downloaded).suggestedFilename(), /v1/);
  await page
    .getByRole("dialog", { name: "月光之门", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("tab", { name: "待办", exact: true }).click();
  await page.locator(".time-task").first().waitFor();
  assert.match(
    await page.locator('[data-task="' + task + '"]').innerText(),
    /完成，尚未交付/,
  );
  assert.equal(await page.getByRole("button", { name: "标记完成" }).count(), 0);
  assert.equal(await page.getByText("已逾期", { exact: true }).count(), 0);
  const priority = page.locator(
    '[data-task="' + task + '"] .task-priority select',
  );
  const prioritySaved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        "/api/mind/time/tasks/" + task + "/control" &&
      r.request().method() === "POST",
  );
  await priority.selectOption("3");
  await prioritySaved;
  await page.waitForFunction(
    (id) =>
      document.querySelector('[data-task="' + id + '"] .task-priority select')
        ?.value === "3",
    task,
  );
  assert.equal(w.mind.time.tasks.get(task).priority, 3);
  for (const width of [1440, 1118, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page
      .locator('[data-task="' + task + '"] .task-priority')
      .evaluate((el) => {
        const label = el.querySelector("span"),
          select = el.querySelector("select"),
          range = document.createRange();
        range.selectNodeContents(label);
        return {
          lines: range.getClientRects().length,
          width: el.getBoundingClientRect().width,
          select: select.getBoundingClientRect().width,
        };
      });
    assert.equal(size.lines, 1, `${width} 优先级必须横向显示`);
    assert.ok(size.width > size.select + 30, `${width} 下拉框不能挤压文字`);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "持续项目", exact: true }).click();
  await page.getByRole("button", { name: "打开项目" }).first().click();
  await page.getByRole("heading", { name: "已经留下的篇章" }).waitFor();
  await page.getByRole("button", { name: "月光资料整理", exact: true }).click();
  const sourceDialog = page.getByRole("dialog", {
    name: "月光资料整理",
    exact: true,
  });
  assert.match(await sourceDialog.innerText(), /模型知识整理 · 未经联网核验/);
  assert.equal(
    await sourceDialog.getByRole("link", { name: "打开来源" }).count(),
    0,
  );
  await sourceDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /第 1 篇 · 月光之门/ }).click();
  await page.locator(".work-body").waitFor();
  assert.match(await page.locator(".work-body").innerText(), /第二段/);
  await page
    .getByRole("dialog", { name: "月光之门", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  mkdirSync("workspace/ui-review", { recursive: true });
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ["今日", "待办", "作品库", "持续项目", "体验记录"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.locator(".time-page").waitFor();
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 2, `${width}/${tab} 横向溢出 ${overflow}`);
    }
    await page.getByRole("tab", { name: "今日", exact: true }).click();
    await page.screenshot({
      path: `workspace/ui-review/time-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("tab", { name: "待办", exact: true }).click();
    await page.locator(".task-priority span").first().waitFor();
    await page.screenshot({
      path: `workspace/ui-review/time-tasks-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "作品库", exact: true }).click();
  await page.locator(".work-card").first().waitFor();
  await page.locator('.dock-link[data-page="life"]').click();
  await page.locator(".page.life").waitFor();
  let release, seen;
  const started = new Promise((r) => (seen = r)),
    hold = new Promise((r) => (release = r));
  await page.route("**/api/mind/time/works?*", async (route) => {
    seen();
    await hold;
    await route.continue();
  });
  w.store.revision++;
  await page.waitForTimeout(1800);
  await page.locator('.dock-link[data-page="time"]').click();
  await page.getByRole("tab", { name: "作品库", exact: true }).click();
  await page.locator(".work-card").first().waitFor({ timeout: 1000 });
  await started;
  const refreshed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/mind/time/works",
  );
  release();
  await refreshed;
  await page.unroute("**/api/mind/time/works?*");
  await page.goto(server.base + "#system/search");
  await page.locator(".search-profile form").waitFor();
  assert.match(
    await page.locator(".search-profile").innerText(),
    /当前使用：模型知识整理/,
  );
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page
    .locator(".search-profile [role=status]")
    .filter({ hasText: "返回 1 条资料" })
    .waitFor();
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
  }
  const ongoing = w.mind.time.primary();
  if (ongoing) w.mind.time.tasks.control(ongoing.id, { action: "pause" });
  w.mind.time.fixtureImmediate = false;
  const gameSource = w.say("private:10001", "10001", "接着玩Rewrite吧");
  const game = w.mind.time.tasks.add({
    activity: "game",
    title: "Rewrite 第1章游玩",
    session: "private:10001",
    sources: [gameSource.seq],
  }).id;
  w.answers.reflection = {
    sufficient: true,
    materials: [
      {
        title: "Rewrite开篇",
        content: "游戏里的场景与人物互动。".repeat(25),
        timing: { minutes: 10, basis: "这一小段情节", chapterMinutes: 120 },
      },
    ],
  };
  await w.life.activities.run();
  await page.goto(server.base + "#time/tasks");
  const gameCard = page.locator('[data-task="' + game + '"]');
  await gameCard.waitFor();
  assert.match(await gameCard.innerText(), /本段预计 8 分钟/);
  assert.ok(!(await gameCard.innerText()).includes("资料模式"));
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
    await page.screenshot({
      path: `workspace/ui-review/time-paced-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("tab", { name: "今日", exact: true }).click();
  await page.locator(".main-activity").waitFor();
  assert.match(await page.locator(".main-activity").innerText(), /正在玩/);
  await page.locator(".time-settings summary").click();
  const pace = page.getByRole("spinbutton", { name: "活动节奏" });
  await pace.fill("1.5");
  w.store.revision++;
  await page.waitForTimeout(1800);
  assert.equal(
    await pace.inputValue(),
    "1.5",
    "后台刷新不能覆盖正在编辑的安排",
  );
  const savedPace = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/mind/time/settings" &&
      r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存安排", exact: true }).click();
  const savedSettings = await savedPace;
  assert.equal(savedSettings.status(), 200);
  assert.equal((await savedSettings.json()).paceSpeed, 1.5);
  assert.equal(w.mind.time.settings().paceSpeed, 1.5);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: TIME views, lazy works, versions/export, delivery status, linked projects, desktop/tablet/mobile, slow refresh and search layout",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
