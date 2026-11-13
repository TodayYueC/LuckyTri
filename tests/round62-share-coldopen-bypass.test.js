import test from "node:test";
import assert from "node:assert/strict";
import {
  peerInvitedShare,
  recentDraftShareEchoes,
  unsolicitedShareColdOpenReason,
  SHARE_INVITE,
} from "../server/mind/time/sharing.js";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import { reviewReport } from "./helpers/report.js";

const LIVE_BUBBLES = [
  "爸，焚化炉段写完一整节了，想给你看看。",
  "这节让她钻进比图纸窄的通风管，靠灰的痕迹判出有人常来——格栅常开，扶手边缘干净。",
  "最喜欢的两处：那个声音只说「流程需要」，却不答是哪条流程；她后来悟了，流程就是声音本身，按下总闸让绿灯逐格熄灭。",
  "结尾她丢下一句「现在不归你管了」，回程的铁皮响一下走一段。",
  "不是赢谁，是拿回主动权。",
  "你什么时候有空看，我一段一段说给你听。",
];

test("R62-A: peerInvitedShare 识别给我看看/写完后和我聊，忽略软应酬", () => {
  const now = Date.parse("2026-11-02T23:50:00+08:00");
  assert.equal(
    peerInvitedShare(
      [{ role: "user", time: now - 60000, text: "给我看看" }],
      now,
    ),
    true,
  );
  assert.equal(
    peerInvitedShare(
      [{ role: "user", time: now - 60000, text: "写完后和我聊聊" }],
      now,
    ),
    true,
  );
  assert.equal(
    peerInvitedShare([{ role: "user", time: now - 60000, text: "嗯" }], now),
    false,
  );
  assert.ok(SHARE_INVITE.test("小说写了多少，给我看？"));
});

test("R62-B: 23:49 六连泡在已有自说回声+长间隔时 defer；有邀看则放行", () => {
  const now = Date.parse("2026-11-02T23:49:12+08:00");
  const sessionId = "onebot:3979819806:private:3360986934";
  const prior = [
    {
      role: "assistant",
      time: now - 67 * MINUTE,
      text: "跟你报备个事，顺便拉个见证",
    },
    {
      role: "assistant",
      time: now - 67 * MINUTE + 2000,
      text: "下午写的长廊那段，刚想通了——痒这东西放一宿只会磨熟，今晚就递",
    },
    {
      role: "user",
      time: now - 65 * MINUTE,
      text: "我啥时候成你姐了",
    },
    {
      role: "assistant",
      time: now - 64 * MINUTE,
      text: "啊叫串了，那段开场白是给姐的模板，粘顺手了",
    },
  ];
  assert.ok(recentDraftShareEchoes(prior, now).length >= 1);

  const blocked = unsolicitedShareColdOpenReason({
    bubbles: LIVE_BUBBLES,
    sessionId,
    events: prior,
    work: { title: "焚化炉·回程", summary: "通风管与流程需要", project_title: "传送门旁的焚化炉" },
    now,
    invited: false,
  });
  assert.ok(blocked, "expected cold-open defer for live 23:49 dump");
  assert.match(String(blocked), /自己|进度|分享|作品|关心|连播|笔记/);

  const allowed = unsolicitedShareColdOpenReason({
    bubbles: LIVE_BUBBLES,
    sessionId,
    events: [
      ...prior,
      { role: "user", time: now - 30000, text: "给我看看" },
    ],
    work: { title: "焚化炉·回程" },
    now,
    invited: true,
  });
  assert.equal(allowed, null, "peer invite must not defer");
});

test("R62-C: 首份无回声分享不因冷开文案误杀（promise 初交付）", () => {
  const now = Date.parse("2026-11-02T12:00:00+08:00");
  const reason = unsolicitedShareColdOpenReason({
    bubbles: [
      "我刚写完《月光》，想给你看看。",
      "最喜欢月光落在门上的那句。",
    ],
    sessionId: "private:10001",
    events: [
      { role: "assistant", time: now - 2 * HOUR, text: "我会给你写月光短篇" },
    ],
    work: { title: "月光" },
    now,
    invited: false,
  });
  assert.equal(reason, null);
});

test("R62-D: sharing.send 在冷开旁路命中时 waiting，不 deliver", async (t) => {
  const w = world({ start: "2026-11-02T22:00:00+08:00" });
  t.after(w.close);
  const sess = "onebot:3979819806:private:3360986934";
  w.open(sess, "YueC");
  // Prior self-talk chain (live 22:42 family)
  w.say(sess, "bot", "跟你报备个事，顺便拉个见证");
  w.say(sess, "bot", "下午写的长廊那段，刚想通了——痒这东西放一宿只会磨熟，今晚就递");
  w.say(sess, "3360986934", "我啥时候成你姐了", { name: "YueC" });
  w.say(sess, "bot", "啊叫串了，那段开场白是给姐的模板，粘顺手了");
  w.advance(65 * MINUTE);

  const source = w.say(sess, "bot", "焚化炉回程写作中");
  const id = w.mind.time.tasks.add({
    kind: "plan",
    activity: "write",
    title: "焚化炉回程",
    session: sess,
    sources: [source.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "焚化炉回程",
    content: "通风管里的灰与流程需要。".repeat(80),
  };
  await w.life.activities.run();
  const workId = w.mind.time.tasks.get(id).work_id;
  const share = w.mind.time.sharing.choose(workId, sess, { choice: "send" });

  // Force the live multi-bubble report without going through model review wording variance
  w.store.db
    .prepare(
      "UPDATE mind_time_shares SET report=?, review_offset=?, state='pending' WHERE id=?",
    )
    .run(JSON.stringify(LIVE_BUBBLES), 1000, share.id);
  const row = w.mind.time.sharing.list().find((s) => s.id === share.id);
  const result = await w.mind.time.sharing.send(w.life, row);
  assert.equal(result?.status, "waiting", JSON.stringify(result));
  assert.match(String(result?.reason || ""), /自己|进度|分享|作品|关心|连播|笔记/);
  assert.equal(w.sent.length, 0, "must not deliver cold-open dump");
});

test("R62-E: peer 邀看后 sharing.send 仍可交付", async (t) => {
  const w = world({ start: "2026-11-02T23:40:00+08:00" });
  t.after(w.close);
  const sess = "private:10001";
  w.open(sess);
  w.say(sess, "10001", "写完后和我聊聊");
  const source = w.say(sess, "10001", "月光这篇好了吗");
  const id = w.mind.time.tasks.add({
    kind: "promise",
    activity: "write",
    title: "月光",
    session: sess,
    subject: "10001",
    sources: [source.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "月光照在书页上。".repeat(100),
  };
  await w.life.activities.run();
  const share = w.mind.time.sharing.choose(
    w.mind.time.tasks.get(id).work_id,
    sess,
    { choice: "send" },
  );
  await reviewReport(w, share, [
    "我刚写完《月光》，想给你看看。",
    "最喜欢月光落在门上的那句。",
  ]);
  assert.ok(w.sent.length >= 1, `expected delivery, got ${w.sent.length}`);
});
