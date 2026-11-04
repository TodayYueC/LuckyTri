import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  hollowEchoAgencyIssues,
  roomUselessCritiqueIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues, speechGlosses } from "../server/core/understanding.js";
import { replyFocus } from "../server/core/conversation-cues.js";

// ============================================================================
// 目标 B · 主观立场 / 反一味附和（基于 2026-11-04 新加坡 Lucky 群 1098056894 & 670380624 真实错例）
// ============================================================================

test("Case 1 (最硬例1 · 11-04 14:58): 北海「感觉sls的氛围听起来确实好」→ Lucky「确实，除HR外听下来都不错，就是画饼含量待观察」被拦截", () => {
  const snapshot = {
    sessionId: "group:1098056894",
    batchIds: [4, 5],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3493168324",
        name: "蓝蓝图",
        text: "不过左老板也是没办法，都是人事那边顶的",
      },
      {
        id: 2,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "但是一直给我画饼啊",
      },
      {
        id: 3,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "跟我说在公司想学就学，多提升一下自己都没问题",
      },
      {
        id: 4,
        role: "user",
        speaker: "1215382790",
        name: "北海虽赊",
        text: "感觉sls的氛围听起来确实好",
      },
      {
        id: 5,
        role: "user",
        speaker: "1215382790",
        name: "北海虽赊",
        text: "xm",
      },
    ],
  };

  const bubbles = ["确实，除HR外听下来都不错，就是画饼含量待观察"];
  const hit = hollowEchoAgencyIssues(bubbles, snapshot);
  assert.ok(hit.length > 0, `expected hollowEchoAgencyIssues, got: ${JSON.stringify(hit)}`);
  assert.ok(groundingIssues(bubbles, snapshot).length > 0);
});

test("Case 1b (11-04 14:59–15:04): 阳当场投诉「缺乏主观能动性/只会一味附和/只会重复别人观点」→ priorityCues + replyFocus(repair) + 拦截「哪句是附和」元辩解", () => {
  const snapshot = {
    sessionId: "group:1098056894",
    batchIds: [10, 11, 12, 13, 14],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "1184883906",
        name: "阳",
        text: "我感觉你这个机器人不行",
      },
      {
        id: 11,
        role: "user",
        speaker: "1184883906",
        name: "阳",
        text: "有点缺乏主观能动性",
      },
      {
        id: 12,
        role: "user",
        speaker: "1184883906",
        name: "阳",
        text: "只会一味附和",
      },
      {
        id: 13,
        role: "user",
        speaker: "1184883906",
        name: "阳",
        text: "就是一个话题，他只会重复别人观点",
      },
      {
        id: 14,
        role: "user",
        speaker: "1184883906",
        name: "阳",
        text: "没啥自己的观点",
      },
    ],
  };

  // 1. priorityCues 必须把无 @ 的附和/无主见投诉识别为 correction 优先线索
  const cues = priorityCues(snapshot.messages, snapshot.batchIds, []);
  assert.ok(cues.length > 0, "should extract agency critique priority cues");
  assert.equal(cues[0].intentHint, "correction");
  assert.match(cues[0].why, /附和|主观能动性|重复别人观点/);

  // 2. replyFocus 必须识别为 repair
  const focus = replyFocus(snapshot, { targetMessageIds: [12, 13] });
  assert.equal(focus.kind, "repair");

  // 3. 15:04 实发元辩解「@阳 哪句是附和……画饼那句是听完我自己说的，你要觉得不行可以说下哪里不行」必须被拦截
  const defensiveReply = [
    "@阳 哪句是附和……画饼那句是听完我自己说的，你要觉得不行可以说下哪里不行",
  ];
  const critHit = roomUselessCritiqueIssues(defensiveReply, snapshot);
  assert.ok(critHit.length > 0, `expected roomUselessCritiqueIssues, got: ${JSON.stringify(critHit)}`);
  assert.ok(groundingIssues(defensiveReply, snapshot).length > 0);
});

test("Case 2 (最硬例2 · 11-04 12:51): 居易问「邮寄的还是线下办的」→ Lucky 照搬问句「办的方式我也好奇，邮寄还是线下的」被拦截，保留第一泡后可通过", () => {
  const snapshot = {
    sessionId: "group:1098056894",
    batchIds: [1, 2, 3],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "昨天刚领了中行和bili联名的万事达一类卡，卡号还是2233开头然后后六位自选",
      },
      {
        id: 2,
        role: "user",
        speaker: "1264317588",
        name: "居易后面的后面是我",
        text: "中行也有吗",
      },
      {
        id: 3,
        role: "user",
        speaker: "1264317588",
        name: "居易后面的后面是我",
        text: "邮寄的还是线下办的",
      },
    ],
  };

  const fullBubbles = [
    "2233开头哈哈，后六位选的啥",
    "办的方式我也好奇， 邮寄还是线下的",
  ];
  const hit = hollowEchoAgencyIssues(fullBubbles, snapshot);
  assert.ok(hit.length > 0, `expected question clone to be caught: ${JSON.stringify(hit)}`);
  assert.ok(groundingIssues(fullBubbles, snapshot).length > 0);

  // 删去照搬问句的第二泡后，第一泡独立追问后六位选号应放行（支持 ReplyDelivery 末泡裁剪自愈）
  assert.deepEqual(hollowEchoAgencyIssues([fullBubbles[0]], snapshot), []);
});

test("Case 3 & Case 11 (最硬例3 · 11-03 12:12 & 11-04 15:38): wszdxmys「真的羡慕死了+1」跟刷在两次场景下均被拦截", () => {
  // Gloss 识别 wszdxmys 与 xm
  assert.ok(speechGlosses("wszdxmys").some((g) => /羡慕/.test(g)));
  assert.ok(speechGlosses("xm").some((g) => /羡慕/.test(g)));

  const snapshotNov3 = {
    sessionId: "group:1098056894",
    batchIds: [1, 2, 3],
    messages: [
      { id: 1, role: "user", speaker: "2126142969", name: "FX战士小城", text: "wszdxmys" },
      { id: 2, role: "user", speaker: "1215382790", name: "北海虽赊", text: "wszdxmys" },
      { id: 3, role: "user", speaker: "1264317588", name: "居易后面的后面是我", text: "wszdxmys" },
    ],
  };
  assert.ok(
    hollowEchoAgencyIssues(["@FX战士小城 wszdxmys，真的羡慕死了+1"], snapshotNov3).length > 0,
  );

  const snapshotNov4PostComplaint = {
    sessionId: "group:1098056894",
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "3493168324", name: "蓝蓝图", text: "wszdxmys" },
    ],
  };
  assert.ok(
    hollowEchoAgencyIssues(
      ["真的羡慕死了+1，你那边是压力麻了，他那边是捧在手心"],
      snapshotNov4PostComplaint,
    ).length > 0,
  );
});

test("Cases 4, 5, 6, 8, 9: 其余 curated 附和/顺杆爬/被拽走立场错例均被拦截", () => {
  // Case 4: 「还挺艺术」→「确实，构图还挺讲究的，极光配三熊叠罗汉」
  assert.ok(
    hollowEchoAgencyIssues(
      ["确实，构图还挺讲究的，极光配三熊叠罗汉"],
      {
        sessionId: "group:1098056894",
        batchIds: [1],
        messages: [
          { id: 1, role: "user", speaker: "2028006017", name: "我在居易后边", text: "还挺艺术，你别说" },
        ],
      },
    ).length > 0,
  );

  // Case 5: 「cursor 的agent 感觉比codex 好用」→「agent我也站cursor，codex架子稳但听话」
  assert.ok(
    hollowEchoAgencyIssues(
      ["想用opus那codex直接出局，cursor里调claude呗", "agent我也站cursor，codex架子稳但听话"],
      {
        sessionId: "group:1098056894",
        batchIds: [1],
        messages: [
          {
            id: 1,
            role: "user",
            speaker: "1264317588",
            name: "居易后面的后面是我",
            text: "cursor 的agent 感觉比codex 好用",
          },
        ],
      },
    ).length > 0,
  );

  // Case 6: 刚表达独立审美「水墨那套挺对我胃口」，转头被北海「前三章除了山就是破房子」拽走：「@北海虽赊 除了山就是破房子…那可能前几章场景确实单薄了」
  const now = Date.now();
  assert.ok(
    hollowEchoAgencyIssues(
      ["@北海虽赊 除了山就是破房子…那可能前几章场景确实单薄了"],
      {
        sessionId: "group:1098056894",
        batchIds: [2],
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "就图论图，水墨那套挺对我胃口，说丑我是没看出来",
            time: now - 30_000,
          },
          {
            id: 2,
            role: "user",
            speaker: "1215382790",
            name: "北海虽赊",
            text: "前三章除了山就是破房子，黄风岭的风格就还不错",
            time: now - 2_000,
          },
        ],
      },
    ).length > 0,
  );

  // Case 8: Rina「这局从头到尾就没齐过，泡面反而是今天最有执行力的安排」→「确实，全群就泡面说到做到」
  assert.ok(
    hollowEchoAgencyIssues(
      ["确实，全群就泡面说到做到"],
      {
        sessionId: "group:670380624",
        batchIds: [1],
        messages: [
          {
            id: 1,
            role: "user",
            speaker: "3979819806",
            name: "Rina",
            text: "这局从头到尾就没齐过，泡面反而是今天最有执行力的安排",
          },
        ],
      },
    ).length > 0,
  );

  // Case 9: 居易「感觉不太像opus啊」→ 第二泡「这确实不像opus，opus编得起码更有底气」
  assert.ok(
    hollowEchoAgencyIssues(
      [
        "错你的时候不指出，自己瞎编的时候倒是很敢编",
        "这确实不像opus，opus编得起码更有底气",
      ],
      {
        sessionId: "group:1098056894",
        batchIds: [1],
        messages: [
          {
            id: 1,
            role: "user",
            speaker: "1264317588",
            name: "居易后面的后面是我",
            text: "感觉不太像opus啊，是我错了的话他也不指出来",
          },
        ],
      },
    ).length > 0,
  );

  // Case 7: 北海「纯浪费时间」→「对求职者来说就是纯浪费」
  assert.ok(
    hollowEchoAgencyIssues(
      ["对求职者来说就是纯浪费"],
      {
        sessionId: "group:1098056894",
        batchIds: [1],
        messages: [
          {
            id: 1,
            role: "user",
            speaker: "1215382790",
            name: "北海虽赊",
            text: "纯浪费时间",
          },
        ],
      },
    ).length > 0,
  );
});

test("Case 12 (正例对照 · 11-02 18:22–25): 有独立审美与明确主见的回复不误伤", () => {
  const snapshot = {
    sessionId: "group:1098056894",
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "1264317588",
        name: "居易后面的后面是我",
        text: "这画面真丑，全是扫描资产堆出来的",
      },
      {
        id: 2,
        role: "user",
        speaker: "1215382790",
        name: "北海虽赊",
        text: "感觉sls的氛围听起来确实好",
      },
    ],
  };

  for (const goodBubbles of [
    ["就图论图，水墨那套挺对我胃口，说丑我是没看出来"],
    ["扫描件不等于白给，光影没接住才显得像橱窗"],
    ["真不真别听嘴上说的，看后面带不带、推不推，落到实处才算数"],
    ["想做gameplay还被主动安排带，这不比空头画饼实在多了"],
    ["确实是这样，不过我倒觉得先把3C跑通比纠结名头更实在"],
  ]) {
    assert.deepEqual(
      hollowEchoAgencyIssues(goodBubbles, snapshot),
      [],
      `should allow independent stance: ${goodBubbles[0]}`,
    );
  }
});
