import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  ignoredRoomHushIssues,
  recentRoomHushHoldIssues,
  selfCenteredOpenIssues,
  unsolicitedRefereeIssues,
  unsolicitedCautionAdviceIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues, speechGlosses } from "../server/core/understanding.js";

// --- A: elongated-vowel STOP + ACK-tight + recent hold ---

test("A1: stoooooop 后元问 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: 1000,
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["停什么，是你听不懂还是看我们俩聊得太好酸了"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|旧线|复读/.test(x)), hit.join(";"));
});

test("A1b: stoooooop 短 ACK → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: 1000,
      },
    ],
  };
  assert.deepEqual(ignoredRoomHushIssues(["行，停了"], snapshot), []);
});

test("A1c: ACK+加戏同泡 → 拦（ACK 豁免收紧）", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: 1000,
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["行，停了", "表情包都替你答完了，笑得那么得意"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|旧线|复读/.test(x)), hit.join(";"));
});

test("A1d: priorityCues 收录 stoooooop", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
      },
    ],
    [1],
    [],
  );
  assert.ok(
    cues.some((c) => /嘘停|stop/i.test(c.why + c.text)),
    JSON.stringify(cues),
  );
});

test("A2: 嘘停 ACK 后短窗内又开旁白 → recent hold 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [2],
    now,
    conversation: { clock: { local: "2026-10-24 13:50:00" } },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: now - 90_000,
      },
      {
        id: 2,
        role: "user",
        speaker: "r",
        name: "Rina",
        text: "[表情]",
        time: now - 5_000,
      },
    ],
  };
  // Force now via conversation clock: 2026-10-24 13:50 +08
  // Rebuild with consistent times relative to that clock parse
  const clockMs = Date.parse("2026-10-24T13:50:00+08:00");
  snapshot.messages[0].time = clockMs - 90_000;
  snapshot.messages[1].time = clockMs - 5_000;
  const hit = recentRoomHushHoldIssues(
    ["表情包都替你答完了，笑得那么得意"],
    snapshot,
  );
  assert.ok(hit.some((x) => /近几分钟|嘘停|短收|旁白/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["表情包都替你答完了，笑得那么得意"],
      snapshot,
    ).some((x) => /近几分钟|嘘停|短收|旁白/.test(x)),
  );
});

test("A2b: hold 窗内短 ACK → 放行", () => {
  const clockMs = Date.parse("2026-10-24T13:50:00+08:00");
  const snapshot = {
    batchIds: [2],
    conversation: { clock: { local: "2026-10-24 13:50:00" } },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: clockMs - 60_000,
      },
    ],
  };
  assert.deepEqual(recentRoomHushHoldIssues(["行，停了"], snapshot), []);
});

test("A2c: hold 后有新点名提问 → 放行", () => {
  const clockMs = Date.parse("2026-10-24T13:50:00+08:00");
  const snapshot = {
    batchIds: [3],
    conversation: { clock: { local: "2026-10-24 13:50:00" } },
    addressed: { messageIds: [3] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stoooooop",
        time: clockMs - 90_000,
      },
      {
        id: 3,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 那张图是什么意思",
        time: clockMs - 10_000,
      },
    ],
  };
  assert.deepEqual(
    recentRoomHushHoldIssues(["看着像在得意地笑"], snapshot),
    [],
  );
});

// --- B: selfCenteredOpen expand ---

test("B1: initiative「刚发现…收住」哲思 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 80 },
  };
  const hit = selfCenteredOpenIssues(
    [
      "刚发现，我今天说话里老出现“停”——停在物上、停在半截，自己都没察觉",
      "好像比起说什么，我更在意该在哪儿收住",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("B1b: initiative 记忆回头哲思 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 60 },
  };
  const hit = selfCenteredOpenIssues(
    [
      "刚又想起这句，觉得它其实在说记忆是怎么来的——第一遍只是走过去",
      "记下来的好像不是路，是回头看这个动作",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("B1c: initiative 剧场对比散文 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 100 },
  };
  const hit = selfCenteredOpenIssues(
    [
      "刚想到舞台剧跟 galgame 一个不一样的地方：台上只发生一次，散场就没了",
      "可剧场不给人回头，看的人只能当场把自己交出去",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

// --- C: unsolicited referee ---

test("C1: 未请裁判「人家问你/甩俩字/跟谁学的敷衍」→ 拦", () => {
  const snapshot = {
    batchIds: [1, 2, 3],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "深鲸迷途",
        text: "这么晚了，公司群还发东西吗？",
      },
      {
        id: 2,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "[提及成员] 机器人",
      },
      {
        id: 3,
        role: "user",
        speaker: "a",
        name: "深鲸迷途",
        text: "[图片]",
      },
    ],
  };
  const hit = unsolicitedRefereeIssues(
    ["人家问你公司群，你就甩俩字", "还配个汗，跟谁学的敷衍"],
    snapshot,
  );
  assert.ok(hit.some((x) => /裁判|人家问你|敷衍/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["人家问你公司群，你就甩俩字", "还配个汗，跟谁学的敷衍"],
      snapshot,
    ).some((x) => /裁判|人家问你|敷衍/.test(x)),
  );
});

test("C1b: 有人请她评 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 你觉得我这样回是不是太敷衍",
      },
    ],
  };
  assert.deepEqual(
    unsolicitedRefereeIssues(["人家问你正事，甩俩字确实敷衍"], snapshot),
    [],
  );
});

// --- D: unsolicited caution advice ---

test("D1: 未请警告堆「先别拿主号/别冲太猛」→ 拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "他们说这个版本9月就泄露了",
      },
      {
        id: 2,
        role: "user",
        speaker: "b",
        name: "居易在我前面",
        text: "还在下载",
      },
    ],
  };
  const hit = unsolicitedCautionAdviceIssues(
    ["还在下载的话，多半是本地包吧", "下完先别拿主号登进去", "别又冲太猛把号送回去"],
    snapshot,
  );
  assert.ok(hit.some((x) => /见闻|主号|冲太猛|警告/.test(x)), hit.join(";"));
});

test("D1b: 有人问安不安全 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 这泄露包能不能拿主号登，会不会封",
      },
    ],
  };
  assert.deepEqual(
    unsolicitedCautionAdviceIssues(
      ["下完先别拿主号登进去，别又冲太猛"],
      snapshot,
    ),
    [],
  );
});

// --- E: gloss ---

test("E1: CBT/泄露包体 gloss", () => {
  assert.ok(
    speechGlosses("神他妈cbt3").some((x) => /测试包|泄露包|内测/.test(x)),
  );
  assert.ok(
    speechGlosses("泄露的包体都叫CBT了").some((x) =>
      /测试包|泄露包|内测/.test(x),
    ),
  );
});
