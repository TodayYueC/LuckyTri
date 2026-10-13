import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  Stickers,
  stickerOutcome,
  fadedWeight,
} from "../server/stickers/index.js";
import {
  atCandidates,
  chosenAt,
  chosenSticker,
  expressionInput,
  expressiveChannel,
} from "../server/stickers/offer.js";
import { onebot } from "../server/channels/onebot/adapter.js";
import {
  modelImageLimits,
  prepareVisionImage,
} from "../server/core/image-preprocessor.js";

const png = (color = "#f00", w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer();
function kernel(now = { t: 1_800_000_000_000 }) {
  const db = new DatabaseSync(":memory:");
  const config = new Map();
  const repo = {
    db,
    config: (k) => config.get(k),
    saveConfig: (k, v) => config.set(k, v),
  };
  return {
    k: new Stickers(repo, { models: null, embedding: null, now: () => now.t }),
    now,
  };
}

test("stickers are checked by their bytes, kept once, and found by meaning", async () => {
  const { k } = kernel();
  await assert.rejects(k.library.add(Buffer.from("not an image")), /只支持/);
  await assert.rejects(k.library.add(Buffer.alloc(3 * 1024 * 1024, 1)), /2MB/);
  const a = await k.library.add(await png(), {
    name: "doge.png",
    category: "无语",
  });
  assert.equal(a.status, "pending");
  assert.equal((await k.library.add(await png())).duplicate, true);
  k.library.update(a.id, {
    description: "一只狗翻白眼",
    meaning: "无语、懒得理你",
    tags: "无语,白眼",
    status: "ready",
  });
  assert.equal(k.library.list({ q: "白眼" }).length, 1);
  assert.equal(k.library.list({ category: "开心" }).length, 0);
  assert.deepEqual(k.library.get(a.id).tags, ["无语", "白眼"]);
  k.library.remove(a.id);
  assert.equal(k.library.list().length, 0);
});

test("a few fitting stickers are offered, a just-used one steps back, none when nothing fits", async () => {
  const { k } = kernel();
  const add = async (color, description, meaning) => {
    const s = await k.library.add(await png(color));
    k.library.update(s.id, { description, meaning, status: "ready" });
    return s;
  };
  const eye = await add("#111", "狗狗翻白眼", "无语 懒得理你");
  await add("#222", "猫咪比心", "开心 喜欢你");
  const offer = await k.candidates({
    session: "g",
    text: "你真的无语死了 懒得理你",
  });
  assert.equal(offer[0].id, eye.id);
  assert.ok(offer.length <= 5);
  assert.deepEqual(
    await k.candidates({ session: "g", text: "明天几点开会" }),
    [],
  );
  k.used({ stickerId: eye.id, session: "g", userId: "10001", topic: "开会" });
  const again = await k.candidates({
    session: "g",
    text: "无语 懒得理你 猫咪 开心",
  });
  assert.notEqual(again[0]?.id, eye.id);
});

test("only a clear answer from that person changes what a sticker means between them", async () => {
  const { k, now } = kernel();
  const s = await k.library.add(await png());
  k.library.update(s.id, {
    description: "狗狗翻白眼",
    meaning: "无语",
    status: "ready",
  });
  k.used({ stickerId: s.id, session: "g", userId: "10001", topic: "加班" });
  k.observe(
    { sessionId: "g", userId: "10002", text: "哈哈哈哈" },
    () => "小红",
  );
  k.observe({ sessionId: "g", userId: "10001", text: "好的" }, () => "阿明");
  assert.equal(k.db.prepare("SELECT COUNT(*) n FROM sticker_bonds").get().n, 0);
  k.observe(
    { sessionId: "g", userId: "10001", text: "哈哈哈哈笑死" },
    () => "阿明",
  );
  const bond = k.db
    .prepare("SELECT * FROM sticker_bonds WHERE user_id='10001'")
    .get();
  assert.ok(bond.weight > 0);
  assert.match(bond.meaning, /加班.*阿明/);
  // The shared moment brings it back when the same thing comes up with him.
  const offer = await k.candidates({
    session: "g2",
    text: "又要加班",
    addressee: "10001",
  });
  assert.equal(offer[0].id, s.id);
  assert.match(offer[0].withThisPerson, /阿明/);
  // A use nobody answers closes without a mark.
  k.used({ stickerId: s.id, session: "g", userId: "10001" });
  now.t += 20 * 60000;
  k.observe({ sessionId: "g", userId: "10001", text: "在吗" });
  assert.equal(
    k.db.prepare("SELECT outcome FROM sticker_uses ORDER BY id DESC").get()
      .outcome,
    "flat",
  );
  assert.equal(stickerOutcome("别发了好尬"), "cold");
  assert.equal(stickerOutcome("明天见"), null);
  assert.ok(Math.abs(fadedWeight(1, 1, 1 + 60 * 86400000) - 0.5) < 1e-9);
});

test("@ goes only to people seen here, at most two, not to the one she is already talking with", () => {
  const session = "onebot:1:group:123";
  const snapshot = {
    sessionId: session,
    messages: [
      { speaker: "10001", name: "阿明", role: "user" },
      { speaker: "10002", name: "小红", role: "user" },
      { speaker: "bot", role: "assistant" },
      { speaker: "10001", name: "阿明", role: "user" },
    ],
  };
  snapshot.canAt = atCandidates(snapshot, session);
  assert.deepEqual(
    snapshot.canAt.map((p) => p.userId),
    ["10001", "10002"],
  );
  assert.deepEqual(
    chosenAt(["99999", "10002"], snapshot, session).map((p) => p.name),
    ["小红"],
  );
  const duo = {
    ...snapshot,
    messages: [
      { speaker: "10001", role: "user" },
      { speaker: "10001", role: "user" },
    ],
  };
  assert.deepEqual(chosenAt(["10001"], duo, session), []);
  assert.deepEqual(atCandidates(snapshot, "onebot:1:private:10001"), []);
  assert.equal(expressiveChannel("qqbot:1:group:1"), false);
  snapshot.stickers = [{ ref: "s1", id: "uuid", looks: "狗" }];
  assert.equal(chosenSticker("s1", snapshot).id, "uuid");
  assert.equal(chosenSticker("s9", snapshot), null);
  assert.equal(expressionInput(snapshot).expression.stickers[0].id, undefined);
  assert.deepEqual(expressionInput({}), {});
});

test("OneBot gets real @ segments and the sticker as inline image bytes", () => {
  const m = { sessionId: "onebot:1:group:123", raw: { group_id: 123 } };
  const at = onebot.sendParams(m, "来了", { at: ["10001", "x"] });
  assert.deepEqual(at.message, [
    { type: "at", data: { qq: "10001" } },
    { type: "text", data: { text: " 来了" } },
  ]);
  const img = onebot.sendParams(m, "", {
    image: { base64: "AAA", sticker: true, summary: "[动画表情]" },
  });
  assert.equal(img.message[0].type, "image");
  assert.equal(img.message[0].data.file, "base64://AAA");
  assert.equal(img.message[0].data.sub_type, 1);
});

test("a large photo is brought down to the owner's image size, not refused", async () => {
  const big = await sharp({
    create: { width: 6000, height: 4000, channels: 3, background: "#abc" },
  })
    .jpeg()
    .toBuffer();
  const limits = {
    ...(
      await import("../server/core/image-preprocessor.js")
    ).visionImageLimits(),
    ...modelImageLimits({ visionMaxSide: 1600, visionMaxMB: 1 }),
  };
  const out = await prepareVisionImage(big, limits);
  assert.ok(Math.max(out.width, out.height) <= 1600);
  assert.ok(out.bytes.length <= 1024 * 1024);
  assert.equal(modelImageLimits({ visionMaxSide: 99999 }).maxDimension, 8192);
});

test("a name typed as @ text becomes a real @ and is not shown twice", async () => {
  const { typedAt } = await import("../server/stickers/offer.js");
  const snapshot = { canAt: [{ userId: "10002", name: "小红" }] };
  assert.deepEqual(typedAt(["@小红 老王在叫你"], [], snapshot), {
    bubbles: ["老王在叫你"],
    at: [{ userId: "10002", name: "小红" }],
  });
  assert.deepEqual(typedAt(["@阿明 在吗"], [], snapshot).at, []);
});
