import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { elapsedLabel } from "../server/mind/clock.js";

const DAY = 24 * HOUR;

test("一周以上的时间不再一律叫“很久以前”", () => {
  const now = Date.parse("2026-10-12T12:00:00+08:00");
  const ago = (days) => elapsedLabel(now - days * DAY, now);
  assert.equal(ago(3), "好几天前");
  assert.equal(ago(9), "一周前");
  assert.equal(ago(20), "两三周前");
  assert.equal(ago(45), "一个多月前");
  assert.equal(ago(200), "几个月前");
  assert.equal(ago(500), "一年多前");
  assert.equal(ago(1000), "很久以前");
});
test("撤销墓碑记在她自己的时间线上", async (t) => {
  const w = world({ start: "2030-01-01T10:00:00+08:00" });
  t.after(w.close);
  w.open("group:1");
  const said = w.say("group:1", "10001", "我最近在学画星空");
  const made = w.mind.self.propose(
    { kind: "interest", content: "我喜欢听他们聊星星", sources: [said.seq] },
    { origin: "solitude", time: w.now() },
  );
  w.mind.revoke("self", made.thread, "不是这样");
  const tomb = w.store.db
    .prepare("SELECT created FROM mind_revocations WHERE target_id=?")
    .get(made.thread);
  assert.equal(tomb.created, w.now());
});
