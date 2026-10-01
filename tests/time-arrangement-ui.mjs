import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
import { unsupportedAction } from "../server/mind/time/availability.js";
const w = world({ paced: true, ownLife: true });
w.life.planner.disabledForTest = true;
w.life.ownDay.disabledForTest = true;
w.open("private:10001", "阿明");
const q = w.say("private:10001", "10001", "给自己留点时间");
const game = w.mind.time.tasks.add({
  title: "游玩《ATRI》",
  activity: "game",
  sources: [q.seq],
}).id;
w.mind.time.tasks.arrange(game, {
  startAt: w.now() + 60 * MINUTE,
  durationMinutes: 40,
  reason: "想看看那段故事",
});
const impossible = w.mind.time.tasks.add({
  title: "今晚点外卖后拍照给你看",
  activity: "unknown",
  kind: "promise",
  sources: [q.seq],
}).id;
w.mind.time.tasks.wait(
  w.mind.time.tasks.get(impossible),
  unsupportedAction(w.mind.time.tasks.get(impossible)),
  Number.MAX_SAFE_INTEGER,
);
const app = await serve(w),
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.base + "#time");
  await page.locator(".day-agenda").waitFor();
  assert.match(
    await page.locator(".main-activity").innerText(),
    /没有主活动.*下一项/s,
  );
  assert.match(
    await page.locator(".main-activity").innerText(),
    /11:00.*40 分钟/s,
  );
  assert.match(await page.locator(".day-agenda").innerText(), /她选定的安排/);
  assert.equal(await page.locator(".agenda-block.free").count(), 0);
  await page.getByRole("tab", { name: "待办", exact: true }).click();
  const waiting = page.locator(`[data-task="${impossible}"]`);
  await waiting.waitFor();
  assert.match(await waiting.innerText(), /需要调整约定.*仍未兑现/s);
  assert.ok(!(await waiting.innerText()).includes("专注段 25 分钟"));
  w.advance(60 * MINUTE);
  w.answers.reflection = {
    sufficient: true,
    materials: [
      {
        title: "ATRI故事中的相遇",
        content:
          "那栋建筑里，少女与来访的人开始交谈，新的故事慢慢展开。".repeat(30),
        timing: { minutes: 50, basis: "这一段剧情的展开" },
      },
    ],
  };
  await w.life.activities.run();
  w.advance(MINUTE);
  w.mind.time.tick();
  await page.goto(app.base + "#time");
  await page.locator(".main-activity").waitFor();
  assert.equal(w.mind.time.primary()?.id, game);
  await page.waitForFunction(
    () =>
      document.querySelector(".main-activity")?.textContent.includes("正在玩"),
    null,
    { timeout: 8000 },
  );
  assert.match(
    await page.locator(".main-activity").innerText(),
    /游玩《ATRI》.*正在玩.*已投入 1 分钟/s,
  );
  assert.match(
    await page.locator(".main-activity").innerText(),
    /这次想投入 40 分钟/,
  );
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: chosen times, idle/next activity, honest capability wait, visible active progress and four screen widths",
  );
} finally {
  await browser.close();
  await app.close();
  w.close();
}
