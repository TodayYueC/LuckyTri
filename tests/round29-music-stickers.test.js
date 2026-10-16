import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { Stickers } from "../server/stickers/index.js";
import { expressionInput } from "../server/stickers/offer.js";
import {
  deliverMusicCard,
  musicSettings,
  saveMusicSettings,
  MUSIC_DEFAULTS,
} from "../server/channels/onebot/music-settings.js";

const png = (color = "#f00") =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
    .png()
    .toBuffer();

function kernel(now = { t: 1_800_000_000_000 }) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_config(id TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  `);
  // stickers schema via Stickers constructor
  const config = new Map();
  const repo = {
    db,
    config: (k, fb) => (config.has(k) ? config.get(k) : fb),
    saveConfig: (k, v) => config.set(k, v),
  };
  // Ensure core_config readable path for music settings when using raw db store
  const store = {
    db,
    config: (k, fb) => {
      const row = db.prepare("SELECT value FROM core_config WHERE id=?").get(k);
      return row ? JSON.parse(row.value) : config.has(k) ? config.get(k) : fb;
    },
    saveConfig: (k, v) => {
      config.set(k, v);
      db.prepare(
        "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      ).run(k, JSON.stringify(v));
    },
  };
  return {
    k: new Stickers(repo, { models: null, embedding: null, now: () => now.t }),
    now,
    store,
    repo,
  };
}

test("M1: music 卡片 RPC 失败有记录；链降级可关", async () => {
  const song = { id: 1, name: "歌", artist: "歌手" };
  const events = [];
  const out = await deliverMusicCard({
    song,
    settings: { ...MUSIC_DEFAULTS },
    sendCard: async () => {
      throw Error("消息体无法解析");
    },
    sendText: async (text) => ({ message_id: 9, text }),
    record: (e) => events.push(e),
  });
  assert.equal(out.degraded, "link");
  assert.equal(events[0].degraded, "link");
  assert.match(events[0].reason, /无法解析/);
  assert.match(events[0].hint, /musicSignUrl|签名/);

  await assert.rejects(
    () =>
      deliverMusicCard({
        song,
        settings: { ...MUSIC_DEFAULTS, failClosed: true, allowLinkFallback: false },
        sendCard: async () => {
          throw Error("签名失败");
        },
        sendText: async () => {
          throw Error("should not link");
        },
        record: (e) => events.push(e),
      }),
    /音乐卡片发送失败/,
  );
  assert.equal(events.at(-1).status, "failed");
  assert.equal(events.at(-1).degraded, null);
});

test("M1b: music 设置读写与三种策略", () => {
  const { store } = kernel();
  assert.deepEqual(musicSettings(store), MUSIC_DEFAULTS);
  const saved = saveMusicSettings(store, {
    musicSignUrl: "https://sign.example/music",
    preferCard: true,
    allowLinkFallback: false,
    failClosed: true,
  });
  assert.equal(saved.musicSignUrl, "https://sign.example/music");
  assert.equal(saved.allowLinkFallback, false);
  assert.equal(saved.failClosed, true);
});

test("E1: 闲聊/斗图本地表情候选多于旧地板", async () => {
  const { k } = kernel();
  const add = async (color, description, meaning) => {
    const s = await k.library.add(await png(color));
    k.library.update(s.id, { description, meaning, status: "ready" });
    return s;
  };
  await add("#111", "狗狗翻白眼", "无语 懒得理你");
  await add("#222", "猫咪比心", "开心 喜欢你");
  await add("#333", "捂脸笑", "好笑 hh");
  const chat = await k.candidates({
    session: "g",
    text: "哈哈好好笑",
    playful: true,
    peerStickers: true,
    limit: 8,
  });
  assert.ok(chat.length >= 1, "斗图/短回应应有候选");
  const eye = await add("#444", "无语脸", "无语");
  k.used({ stickerId: eye.id, session: "g", userId: "1", topic: "x" });
  // 10min hard cool: immediately excluded
  const soon = await k.candidates({
    session: "g",
    text: "无语 懒得理你",
    playful: true,
  });
  assert.ok(!soon.some((s) => s.id === eye.id));
});

test("E2: 库空/未描述可诊断", async () => {
  const { k } = kernel();
  assert.match(k.diagnosis(), /空|导入/);
  const s = await k.library.add(await png());
  // pending without description
  assert.match(k.diagnosis(), /描述/);
  k.library.update(s.id, {
    description: "一只猫",
    meaning: "可爱",
    status: "ready",
  });
  assert.equal(k.diagnosis(), "");
});

test("E1b: stickerNote 中性，不再强调不必为用而用", () => {
  const note = expressionInput({
    stickers: [{ ref: "s1", looks: "猫" }],
  }).expression.stickerNote;
  assert.match(note, /合适就用/);
  assert.equal(/不必为用而用/.test(note), false);
});
