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
