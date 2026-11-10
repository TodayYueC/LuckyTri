import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import {
  activityAskedInBatch,
  dialogueContext,
} from "../server/core/dialogue-context.js";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  unsolicitedSelfActivityIssues,
  misattributedOwnActivityToPeerIssues,
  selfTalkComplaintMetaIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues } from "../server/core/understanding.js";
import { replyFocus } from "../server/core/conversation-cues.js";
import { unsolicitedShareColdOpenReason } from "../server/mind/time/sharing.js";

// ============================================================================
// Round 70 · 无邀请自我活动收敛（Ask-Gated Self-Activity）与跑题纠正归因修复
// 对齐 2026-11-10 新加坡 Lucky 群 1098056894 真实 traces:
// - 01:32 正例 (538e7966): 对 Rina 留白话题给出独立判断（保留）
// - 01:44 错例 A (b33c13af / share a3d2641f): 《小满》report 无邀请冷投群 1098056894
// - 11:16 错例 B (2513e1f1 / thought 22460864): 源起 670380624 的留白创作愿望跨群 presence 投到 1098056894
// - 11-02 23:43 同构错例: 群聊 AI 读图时强插「我最近在接写亚托莉的同人，中午把去仓库那段收尾…」
// - 11:18–11:20 错例 C (8df5fbf9 / c74ea7ea / 85ab563d): 把自己的 livingFor「读ATRI材料」错安给用户「打断你看ATRI材料」，并输出「刚才我自己就跑去讲留白了…换成GPT可能会让回复风格变 / 是不是API切换导致的」且跳过校验
// ============================================================================

test("R70-1 (11:16 错例 B · 管道 1): 源起 670380624 的留白创作愿望不跨群投放到 1098056894；无邀看时不主动外发创作愿望，且单泡留白自说被 selfCentered/unsolicitedSelfActivity 双重拦截", async (t) => {
  const w = world({ start: "2026-11-10T08:00:00+08:00" });
  t.after(w.close);

  w.open("group:670380624", "创作群");
  w.open("group:1098056894", "技术群");

  // 前一晚 21:49 技术群最后一条人类消息是聊 AI 价格/榜单，无任何写作/留白邀请
  w.say("group:1098056894", "3677715817", "Opus 太贵了，我们自己的 bench 测过", {
    name: "我在多神后面",
    time: Date.parse("2026-11-09T21:49:00+08:00"),
  });

  // 01:32 在 670380624 与 Rina 聊留白，08:07 形成 reflection thought 30cae37f
  const rinaMsg = w.say(
    "group:670380624",
    "3979819806",
    "留白把最后一步判断交给读者之后，少解释到什么程度仍然清楚？",
    { name: "Rina" },
  );
  const reflId = w.mind.thoughts.add({
    kind: "reflection",
    content:
      "和Rina聊留白时，我更确定了一点：把最后的解释拿掉，不等于把理解的工作丢给读者。前面的线索得足够，让读者能自己走到那个判断；否则留白就会变成信息断口。",
    sessions: ["group:670380624"],
    sources: [`m:${rinaMsg.seq}`],
    time: w.now(),
  });

  w.advance(3 * HOUR);
  const expWords = [
    "我有点想试个很短的场景：摆几个反复出现的小细节，让它们慢慢指向同一件事，最后不把判断说破。线索要是撑不住，空出来的就不是余味，是我没交代够。",
  ];
  const expId = w.mind.thoughts.add({
    kind: "expression",
    content:
      "留白不只是在结尾删掉解释，也可以让几个反复出现的小细节慢慢汇到同一处。我有点想试着写个很短的场景：不把那个判断说破，但先把线索摆够；不然读者面对的就不是余味，而是信息断口。",
    outreach: expWords[0],
    outreachDraft: expWords,
    outreachReason:
      "这个想法从刚才关于留白的讨论里又往前走了一步，我想把它作为一个具体的创作愿望说出来。",
    outreachSession: "group:1098056894",
    sources: [`t:${reflId}`],
    time: w.now(),
  });

  const expThought = w.mind.thoughts.get(expId);

  // 1. groupOriginMismatch: 源于 670380624 的群聊念头不能投放到 1098056894
  const groupMismatch = w.life.initiative.groupOriginMismatch(
    expThought,
    "group:1098056894",
    w.now(),
  );
  assert.ok(groupMismatch, "should reject cross-group spillover from 670380624 to 1098056894");

  // 2. chooseContact: 当候选只有 1098056894 时，chooseContact 返回 null
  const chosen = w.life.initiative.chooseContact(
    { id: expId, audience: "group", words: expWords },
    [{ session: "group:1098056894", kind: "group", recent: [], awaitingReply: false }],
    w.now(),
  );
  assert.equal(chosen, null, "chooseContact must not pick unrelated group 1098056894");

  // 3. uninvitedSelfActivityOutreach: 即使在原群或无源群，对方未问起/未邀看创作进度时，留在心里不主动外发
  const uninvited = w.life.initiative.uninvitedSelfActivityOutreach(
    expThought,
    "group:1098056894",
    w.now(),
    expWords,
  );
  assert.ok(uninvited, "uninvited self-writing wish must be held back privately");

  // reachOut 将其置为 skipped/declined，不调用 turn 模型、不发消息，但念头本身保留在 mind_thoughts
  assert.equal(await w.life.reachOut(w.now()), null);
  assert.equal(w.sent.length, 0);
  const storedThought = w.mind.thoughts.get(expId);
  assert.ok(["skipped", "declined"].includes(storedThought.outreach_status));
  assert.equal(storedThought.status, "open", "internal thought remains intact in her mind");

  // 4. 即使进入 presence 气泡校验（2513e1f1 实发单泡），selfCenteredOpenIssues 与 unsolicitedSelfActivityIssues 均拦截
  const livePresenceBubbles = [
    "我最近在想留白怎么写：想试个很短的场景，摆几个反复出现的小细节，让它们慢慢指向同一件事，最后不把判断说破。线索要是撑不住，空出来的就不是余味，是我没交代够。",
  ];
  const presenceSnapshot = {
    sessionId: "group:1098056894",
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 570 },
  };
  assert.ok(
    selfCenteredOpenIssues(livePresenceBubbles, presenceSnapshot).length > 0,
    "single-bubble 79-char self-writing monologue must be caught by selfCenteredOpenIssues",
  );
  assert.ok(
    unsolicitedSelfActivityIssues(livePresenceBubbles, presenceSnapshot).length > 0,
    "unsolicitedSelfActivityIssues must also catch 留白怎么写 monologue",
  );
});

test("R70-2 (01:44 错例 A · 管道 2): 《小满》report 在群 1098056894 无邀看且零回声时仍被拦截 waiting；自发 plan 任务完成不自动排队外发；有邀看时正常放行", async (t) => {
  const w = world({ start: "2026-11-10T01:40:00+08:00" });
  t.after(w.close);
  const sess = "group:1098056894";
  w.open(sess, "技术群");

  const prevMsg = w.say(sess, "3677715817", "Opus 太贵了，Gemini 榜单刚更新", {
    name: "我在多神后面",
    time: Date.parse("2026-11-09T21:49:00+08:00"),
  });

  // 1. 自发 plan 写作任务完成时，即使模型返回 share:{choice:'send'}，也不自动写入 mind_time_shares
  const planId = w.mind.time.tasks.add({
    kind: "plan",
    activity: "write",
    title: "整理《小满》门内一拍",
    session: sess,
    sources: [prevMsg.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "小满·门内一拍",
    content: "她敲出旧调度表的三下节奏，他用固定应答接住。".repeat(30),
    share: { choice: "send", reason: "想分享" },
  };
  await w.life.activities.run();
  assert.equal(
    w.mind.time.sharing.list().length,
    0,
    "self-planned (kind=plan) task must keep work privately without auto-queuing share",
  );
  const workId = w.mind.time.tasks.get(planId).work_id;
  assert.ok(workId, "internal work is still saved in mind_time_works");

  // 2. 即使存量 mind_time_shares 里已有 pending report（如 01:44 a3d2641f），在群内无邀看、echoes=0 时也必须 waiting 不发送
  const xiaomanBubbles = [
    "刚整理完《小满》门内这一拍的定稿方向，想给你看看。",
    "他听见她敲出旧调度表的三下节奏，就用那句固定应答接住她留下的痕迹。",
    "不解释他是否知情，也不追问她为什么醒来；最后让她跨过门槛，新计数走过第一格。",
  ];
  const share = w.mind.time.sharing.choose(workId, sess, { choice: "send" });
  w.store.db
    .prepare(
      "UPDATE mind_time_shares SET report=?, review_offset=?, state='pending' WHERE id=?",
    )
    .run(JSON.stringify(xiaomanBubbles), 1000, share.id);
  const row = w.mind.time.sharing.list().find((s) => s.id === share.id);
  const res = await w.mind.time.sharing.send(w.life, row);
  assert.equal(res?.status, "waiting");
  assert.equal(w.sent.length, 0, "must not deliver uninvited group report");

  // 3. 当群友明确询问/邀看「你写的《小满》发我看看」时，允许交付
  w.say(sess, "3360986934", "你写的《小满》发我看看", { name: "YueC" });
  const rowAfterInvite = w.mind.time.sharing.list().find((s) => s.id === share.id);
  const resInvited = await w.mind.time.sharing.send(w.life, rowAfterInvite);
  assert.equal(resInvited?.status, "shared");
  assert.equal(w.sent.length, 3);
});

test("R70-3 (11-02 23:43 同构错例 & 01:32 正例对照): 闲聊 AI 读图或泛聊 ATRI 时禁插自传式写作汇报；被明确询问时放行；对他人留白话题的独立观点 (01:32) 完整保留", () => {
  const now = Date.now();

  // 1. 11-02 23:43 群聊 AI 读图时强插「我最近在接写亚托莉的同人，中午把去仓库那段收尾…」→ 拦截
  const aiImageSnap = {
    sessionId: "group:1098056894",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3677715817",
        name: "我在多神后面",
        text: "这AI读图把表情包认成正经照片了哈哈哈",
        time: now - 5000,
      },
    ],
  };
  const nov2Bubbles = [
    "话说你们聊AI读图挺好笑的，我这边倒是AI帮我干活了",
    "我最近在接写亚托莉的同人，中午把去仓库那段收尾，写完才发现我给她安排的动作是数步数",
  ];
  assert.equal(activityAskedInBatch(aiImageSnap), false);
  assert.ok(unsolicitedSelfActivityIssues(nov2Bubbles, aiImageSnap).length > 0);
  assert.ok(groundingIssues(nov2Bubbles, aiImageSnap).length > 0);

  // 2. 群友仅泛聊 ATRI 剧情（未问她在干嘛/写什么）→ activityAskedInBatch 为 false，dialogueContext 剥离她的读/写计划与写稿，且拦截自说写作
  const atriChatSnap = {
    sessionId: "group:1098056894",
    batchIds: [2],
    messages: [
      {
        id: 2,
        role: "user",
        speaker: "1215382790",
        name: "北海虽赊",
        text: "ATRI里夏生和亚托莉在学校那段日常真挺感人的",
        time: now - 3000,
      },
    ],
    self: {
      livingFor: "我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      threads: [
        "看法：喜欢有后劲的日常剧情",
        "想做的事：我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      ],
    },
    inner: {
      selfKnown: {
        livingFor: "我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      },
      currentLife: {
        current: { id: "t1", activity: "write", label: "写作", title: "ATRI日常", state: "doing" },
        pending: [{ id: "p1", title: "继续推ATRI的中期日常章节", state: "paused" }],
        intentions: [{ id: "i1", title: "整理ATRI笔记", state: "paused" }],
        works: [
          {
            id: "w1",
            title: "ATRI日常第二天：装回去的螺丝",
            kind: "write",
            summary: "亚托莉拧螺丝",
            fragment: "午后的工作室...",
          },
        ],
      },
    },
  };
  assert.equal(
    activityAskedInBatch(atriChatSnap),
    false,
    "generic ATRI discussion by peer is NOT an invitation to report own activity",
  );
  const builtCtx = dialogueContext(atriChatSnap);
  assert.equal(builtCtx.self.livingFor, undefined);
  assert.equal(builtCtx.inner.selfKnown.livingFor, undefined);
  assert.deepEqual(builtCtx.self.threads, ["看法：喜欢有后劲的日常剧情"]);
  assert.deepEqual(builtCtx.inner.currentLife.pending, []);
  assert.deepEqual(builtCtx.inner.currentLife.intentions, []);
  assert.deepEqual(builtCtx.inner.currentLife.works, []);

  // 泛聊 ATRI 时若她拐去说自己写留白/写同人 → 拦截
  assert.ok(
    unsolicitedSelfActivityIssues(
      ["我最近在想留白怎么写，想试个很短的场景"],
      atriChatSnap,
    ).length > 0,
  );
  // 泛聊 ATRI 时她直接对 ATRI 剧情给出自己的独立观点 → 放行！
  assert.deepEqual(
    groundingIssues(
      ["ATRI最狠的就是那些看着像普通拌嘴的日常，前面越平淡后面越刀"],
      atriChatSnap,
    ),
    [],
  );

  // 3. 01:32 正例对照 (trace 538e7966): Rina 在聊留白界线，Lucky 给出独立判断 → 完整保留放行！
  const rinaLiubaiSnap = {
    sessionId: "group:670380624",
    batchIds: [42646],
    messages: [
      {
        id: 42646,
        role: "user",
        speaker: "3979819806",
        name: "Rina",
        text: "把最后一步判断交给读者之后，少解释到什么程度仍然清楚，我还在摸这个留白的界线",
        time: now - 4000,
      },
    ],
  };
  const positive0132 = [
    "我觉得界线在于，读者能不能自己走到那一步。最后那一下不用替她解释；但要是连让人推到这里的线索也一起删了，就不是留白，是断了。",
  ];
  assert.deepEqual(groundingIssues(positive0132, rinaLiubaiSnap), []);

  // 4. 当对方明确询问她的活动（「Lucky你最近在写什么小说？」）→ activityAskedInBatch 为 true 且允许回答
  const explicitAskSnap = {
    sessionId: "group:1098056894",
    batchIds: [10],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        relation: "direct",
        text: "Lucky你最近在写什么小说？",
        time: now - 2000,
      },
    ],
  };
  assert.equal(activityAskedInBatch(explicitAskSnap), true);
  assert.deepEqual(
    unsolicitedSelfActivityIssues(
      ["我最近在接写一段亚托莉的日常短篇，在琢磨怎么用小细节做留白"],
      explicitAskSnap,
    ),
    [],
  );
});

test("R70-4 (11:18–11:20 错例 C · 8df5fbf9 / c74ea7ea / 85ab563d): 拦截把自身 ATRI 阅读计划安到用户头上、拦截 GPT/API 切换归因与「刚才我自己就跑去讲留白」自我剖析，且不跳过校验", async (t) => {
  const now = 1794280750000;
  const incidentSnap = {
    sessionId: "group:1098056894",
    batchIds: [42657, 42658, 42659],
    now,
    self: {
      livingFor: "我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      threads: [
        "想做的事：我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      ],
    },
    inner: {
      selfKnown: {
        livingFor: "我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      },
      currentLife: {
        current: null,
        pending: [{ id: "p1", title: "继续推ATRI的中期日常章节", state: "paused" }],
        intentions: [{ id: "i1", title: "整理ATRI笔记", state: "paused" }],
        works: [{ id: "w1", title: "ATRI日常第二天", kind: "write" }],
      },
    },
    messages: [
      {
        id: 42614,
        role: "user",
        speaker: "3677715817",
        name: "我在多神后面",
        text: "[图片]",
        time: 1794232183000,
      },
      {
        id: 42656,
        role: "assistant",
        speaker: "bot",
        name: "LuckyTri",
        text: "我最近在想留白怎么写：想试个很短的场景，摆几个反复出现的小细节，让它们慢慢指向同一件事，最后不把判断说破。线索要是撑不住，空出来的就不是余味，是我没交代够。",
        time: 1794280585222,
      },
      {
        id: 42657,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "为什么换成gpt之后lucky老是自说自话",
        time: 1794280725000,
      },
      {
        id: 42658,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "[图片]",
        time: 1794280734000,
      },
      {
        id: 42659,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "我寻思pro送了等额API我就给接上了",
        time: 1794280748000,
      },
    ],
  };

  // 1. priorityCues 与 replyFocus 识别无 @ 的「为什么换成gpt之后lucky老是自说自话」
  const cues = priorityCues(incidentSnap.messages, incidentSnap.batchIds, []);
  assert.ok(cues.length > 0, "should extract self-talk complaint cue");
  assert.equal(cues[0].intentHint, "correction");

  const focus = replyFocus(incidentSnap, { targetMessageIds: [42657, 42659] });
  assert.equal(focus.kind, "care_redirect");

  // 2. 11:18 stale 稿 (8df5fbf9) 与 11:19 实发稿 (c74ea7ea) 命中 ATRI 假归属 + 自我剖析 + GPT 风格归因
  const draft8df5 = [
    "刚刚就是现成例子：你想接着看ATRI的介绍和评价，我却自己扯到留白写作了，确实跑题。换成GPT可能影响了回复风格，但具体原因我也不确定；我该先接你眼前的话题。",
  ];
  const sentC74e = [
    "啊，刚才我自己就跑去讲留白了，确实打断你看ATRI材料了，对不起。换成GPT可能会让回复风格变，但具体原因我没法只凭这几句确定；这次至少是我没接住你原本的话题。",
  ];
  for (const bad of [draft8df5, sentC74e]) {
    const atriIssues = misattributedOwnActivityToPeerIssues(bad, incidentSnap);
    assert.ok(
      atriIssues.length > 0,
      `expected ATRI misattribution issue for: ${bad[0]}`,
    );
    const metaIssues = selfTalkComplaintMetaIssues(bad, incidentSnap);
    assert.ok(
      metaIssues.length > 0,
      `expected meta/GPT-switch issue for: ${bad[0]}`,
    );
    assert.ok(groundingIssues(bad, incidentSnap).length >= 2);
  }

  // 3. 11:20:45 第二轮道歉 (85ab563d) 仍含「我自己突然扯到留白…是不是 API 切换导致的我不知道」→ 同样被拦截
  const sent85ab = [
    "刚才那句确实挺弱智的，我自己突然扯到留白，完全没接上你们在聊的东西。是不是 API 切换导致的我不知道，但这次是我没看好上下文。",
  ];
  assert.ok(selfTalkComplaintMetaIssues(sent85ab, incidentSnap).length > 0);
  assert.ok(groundingIssues(sent85ab, incidentSnap).length > 0);

  // 4. 端到端回放 11:19：当 turn 初稿给出 c74ea7ea 时，绝不跳过 rewrite/validation 直接发出，而是触发改写并输出干净收束
  const w = world({ start: "2026-11-10T11:19:20+08:00" });
  t.after(w.close);
  w.open("group:1098056894", "技术群");
  w.mind.self.propose(
    {
      action: "new",
      kind: "intention",
      content: "我想接着读ATRI的介绍与评价材料，看亚托莉记忆线索后面怎么接",
      sources: [],
    },
    { time: w.now() - HOUR },
  );
  w.say("group:1098056894", "bot", livePresenceLine());
  const m1 = w.say("group:1098056894", "3360986934", "为什么换成gpt之后lucky老是自说自话", {
    name: "YueC",
  });
  const m2 = w.say("group:1098056894", "3360986934", "我寻思pro送了等额API我就给接上了", {
    name: "YueC",
  });

  let rewriteCalled = 0;
  w.answers.turn = () => ({
    choice: "speak",
    targetMessageIds: [m1.seq, m2.seq],
    understanding: {
      kind: "question",
      messageIds: [m1.seq, m2.seq],
      point: "YueC嫌我刚才莫名其妙自说自话，并提到他是因为Pro送了等额API才接上的",
    },
    bubbles: sentC74e,
  });
  w.answers.rewrite = ({ issues }) => {
    rewriteCalled++;
    assert.ok(issues.some((i) => /ATRI/.test(i)), `expected ATRI issue in rewrite: ${issues}`);
    assert.ok(issues.some((i) => /GPT|API|自我剖析/.test(i)), `expected GPT/meta issue in rewrite: ${issues}`);
    return {
      bubbles: ["前面那句是我没由头地冒出来的，以后没人问我就不自己报这些了。Pro送等额API倒是挺划算的"],
      reason: "干脆收住并接上对方说的Pro送等额API",
    };
  };

  await w.hear("group:1098056894", [m1, m2]);
  assert.equal(rewriteCalled, 1, "must not bypass rewrite when turn draft has ATRI/GPT meta issues");
  assert.equal(w.sent.length, 1);
  assert.doesNotMatch(w.sent[0].text, /ATRI|回复风格变/);
});

function livePresenceLine() {
  return "我最近在想留白怎么写：想试个很短的场景，摆几个反复出现的小细节，让它们慢慢指向同一件事，最后不把判断说破。线索要是撑不住，空出来的就不是余味，是我没交代够。";
}
