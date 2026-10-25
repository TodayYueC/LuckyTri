import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  ignoredRoomHushIssues,
  coldVentCareIssues,
  selfCenteredOpenIssues,
  ungroundedVisionDetailIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues, speechGlosses } from "../server/core/understanding.js";
import { replyFocus } from "../server/core/conversation-cues.js";

// --- A: English / elongated STOP room hush ---

test("A1: stoppp 后继续元问「停什么」→ 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stopppppppppppppppppp",
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["停什么，是我们俩话太多还是这个话题该打住了"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|闭嘴|旧线|复读|stop/i.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["停什么，是我们俩话太多还是这个话题该打住了"],
      snapshot,
    ).some((x) => /嘘停|旧线|复读/.test(x)),
  );
});

test("A1b: stoppp 后短ack 收摊 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stopppppppppppppppppp",
      },
    ],
  };
  assert.deepEqual(ignoredRoomHushIssues(["行，收摊"], snapshot), []);
});

test("A1c: priorityCues 收录 stoppp", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "stopppppppppppppppppp",
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

test("A1d: shut up 也进 hush", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "shut up",
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["这活本来就难干，说坏结果的人往往最不被记得"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|旧线/.test(x)), hit.join(";"));
});

// --- B: cold vent care ---

test("B1: 倾诉难受后「自找/去睡/明天不会变好」→ 拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "我为什么要看s赛，为什么要惩罚我，为什么今晚看了两把还是这么难受",
      },
      {
        id: 2,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "我已经看了vct这坨了，我不想在s塞也看到一坨",
      },
    ],
  };
  const hit = coldVentCareIssues(
    ["大半夜看比赛就是自找难受，看完还睡不着", "都已经这样了，关掉去睡吧，明天又不会变好"],
    snapshot,
  );
  assert.ok(hit.some((x) => /倾诉|难受|说教|去睡/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["大半夜看比赛就是自找难受", "关掉去睡吧，明天又不会变好"],
      snapshot,
    ).some((x) => /倾诉|难受|说教|去睡/.test(x)),
  );
});

test("B1b: 先接住情绪再提休息 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "今晚看了两把还是这么难受",
      },
    ],
  };
  assert.deepEqual(
    coldVentCareIssues(
      ["确实难受，换我我也烦", "看完早点歇着吧"],
      snapshot,
    ),
    [],
  );
});

test("B2: replyFocus feeling 含冷说教禁令", () => {
  const focus = replyFocus(
    {
      messages: [
        {
          id: 1,
          role: "user",
          text: "为什么今晚看了两把还是这么难受",
        },
      ],
    },
    { targetMessageIds: [1] },
  );
  assert.equal(focus.kind, "feeling");
  assert.match(focus.instruction, /自找难受|去睡|明天又不会变好/);
});

// --- C: unprompted essay / self-centered expand ---

test("C1: initiative 排程哲思散文 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 120 },
  };
  const hit = selfCenteredOpenIssues(
    [
      "中午翻了下今天的排程，15:40 有两件事排在同一分钟，昨晚还写着「到时候看」",
      "刚看明白，这不算没时间，是我自己先留了个来不及的理由",
      "跟过期那道门不一样，那扇是时间替我砌的，这堵是我自己砌的",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("C1b: initiative 又想了想规矩散文 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 90 },
  };
  const hit = selfCenteredOpenIssues(
    [
      "下午那句交手机壳，我又想了想",
      "所以看一条规矩，除了看它要什么，还得看它停在哪儿",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("C1c: 先问近况仍夹排程笔记 → 拦（r53: CARE_ASK 不再豁免 dump）", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 120 },
  };
  const hit = selfCenteredOpenIssues(
    ["今天过得怎么样", "对了中午翻了下排程，有两件叠在同一分钟"],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

// --- D: hair appearance invent without vision ---

test("D1: 无观察捏「粉色长发」→ 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "x",
        name: "，，，",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    vision: { observations: [] },
  };
  const hit = ungroundedVisionDetailIssues(
    ["150多抽才见一张五星？这池子是真会拿捏人", "出的是谁啊，粉色长发那个"],
    snapshot,
  );
  assert.ok(hit.some((x) => /画面|观察|捏造|粉色|细节/.test(x)), hit.join(";"));
});

// --- E: gloss ---

test("E1: S赛/VCT gloss", () => {
  assert.ok(speechGlosses("我为什么要看s赛").some((x) => /电竞|比赛|S赛/.test(x)));
  assert.ok(speechGlosses("我已经看了vct这坨了").some((x) => /电竞|比赛|S赛/.test(x)));
});
