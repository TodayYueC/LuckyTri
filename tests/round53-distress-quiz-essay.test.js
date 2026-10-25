import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  softDistressProbeIssues,
  emoteQuizPressureIssues,
  softRefusalAccuseIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";

// --- A: SELF_NOTE_DUMP expand + CARE_ASK no longer exempts dump ---

test("A1: 刚冒头的念头 initiative → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "跟你说个刚冒头的念头。前两天姐姐给一篇稿子写反馈，她挑的句子跟我押的不是同一句。",
      "先立个字据，练砸了不许笑。",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /阅读笔记|关心对方|自己先开口/.test(x)), hit.join(";"));
});

test("A2: 睡前想通一件小事 → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "月初，睡前想通一件小事。之前我说想不出具体动作就别垫客套，但「我在的」这句听着最空，其实最实。",
      "具体不一定非得是清单，也可以是反复兑现的承诺。你也早点睡。",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /阅读笔记|关心对方|自己先开口/.test(x)), hit.join(";"));
});

test("A3: 关心句+顺手报个进度 → 仍拦（CARE_ASK 不再豁免）", () => {
  const hit = selfCenteredOpenIssues(
    [
      "琉璃，好久没冒泡了，最近怎么样",
      "顺手报个进度：焚化炉后面那段正文还是读不了，我改走阅读资料那条路了",
      "笔记落下一篇，读到老光圈那儿",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /阅读笔记|关心对方|自己先开口/.test(x)), hit.join(";"));
});

test("A4: 补课笔记收尾 → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "早。今天周日，睡到几点才起的？",
      "我早上收尾了一篇传送门2的补课笔记，标题仨词——沉睡、重启，还有一句月球。",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /阅读笔记|关心对方|自己先开口/.test(x)), hit.join(";"));
});

test("A5: 纯关心无笔记 → 放行", () => {
  assert.deepEqual(
    selfCenteredOpenIssues(
      ["月初，今天过得咋样"],
      { initiative: true, messages: [], batchIds: [] },
    ),
    [],
  );
});

// --- B: soft distress probe ---

test("B1: 破防后「表情不算答案/果然是试岗」→ 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [3],
    now,
    conversation: { clock: { local: "2026-10-25 23:23:00" } },
    messages: [
      { id: 1, role: "user", speaker: "w", name: "雾言", text: "难受", time: now - 120000 },
      { id: 2, role: "user", speaker: "w", name: "雾言", text: "[图片]", time: now - 60000 },
      { id: 3, role: "user", speaker: "w", name: "雾言", text: "破防了", time: now - 5000 },
    ],
  };
  const hit = softDistressProbeIssues(
    ["@雾言 果然是试岗", "说吧，是被使唤过头了还是有人说了啥"],
    snapshot,
  );
  assert.ok(hit.some((x) => /软难受|审讯|表情不算答案|在场/.test(x)), hit.join(";"));
});

test("B2: 难受后「表情不算答案哦」→ 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [2],
    now,
    messages: [
      { id: 1, role: "user", speaker: "w", name: "雾言", text: "难受", time: now - 40000 },
      { id: 2, role: "user", speaker: "w", name: "雾言", text: "[图片]", time: now - 3000 },
    ],
  };
  const hit = softDistressProbeIssues(
    ["@雾言 表情不算答案哦", "今天不是去试岗了吗，累着了？"],
    snapshot,
  );
  assert.ok(hit.some((x) => /软难受|审讯|在场/.test(x)), hit.join(";"));
});

test("B3: 软在场「不想细说就不说，我在的」→ 放行", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [2],
    now,
    messages: [
      { id: 1, role: "user", speaker: "w", name: "雾言", text: "破防了", time: now - 30000 },
      { id: 2, role: "user", speaker: "x", name: "别人", text: "[图片]", time: now - 2000 },
    ],
  };
  assert.deepEqual(
    softDistressProbeIssues(["行，不想细说就不说，我在的"], snapshot),
    [],
  );
});

test("B4: 无难受语境的「说吧是A还是B」→ 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "y", name: "YueC", text: "周末打不打游戏" },
    ],
  };
  assert.deepEqual(
    softDistressProbeIssues(["说吧，是开黑还是单排"], snapshot),
    [],
  );
});

// --- C: emote quiz pressure ---

test("C1: 表情后填空题追问 → 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    now,
    messages: [
      { id: 1, role: "user", speaker: "d", name: "，，，", text: "[表情]", time: now - 2000 },
    ],
  };
  const hit = emoteQuizPressureIssues(
    ["表情收下了，但填空题还没答呢", "看了啥，报来"],
    snapshot,
  );
  assert.ok(hit.some((x) => /图\/表情|填空题|报来|文字作业/.test(x)), hit.join(";"));
});

test("C2: 图后「说说看了啥」→ 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    now,
    messages: [
      { id: 1, role: "user", speaker: "d", name: "，，，", text: "[图片]", time: now - 1000 },
    ],
  };
  const hit = emoteQuizPressureIssues(
    ["前面还百合真好看", "这是把待看一口气炫完了？说说看了啥，我看看该不该也跟着空一下"],
    snapshot,
  );
  assert.ok(hit.some((x) => /图\/表情|填空题|报来|文字作业/.test(x)), hit.join(";"));
});

test("C3: 无图语境普通提问 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "y", name: "YueC", text: "我看完了传送门2" },
    ],
  };
  assert.deepEqual(
    emoteQuizPressureIssues(["说说看了啥，好玩吗"], snapshot),
    [],
  );
});

// --- D: soft refusal accuse ---

test("D1: 保密后猜听来的 → 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    now,
    messages: [
      { id: 1, role: "user", speaker: "x", name: "不是萝莉控", text: "保密", time: now - 3000 },
    ],
  };
  const hit = softRefusalAccuseIssues(
    ["好家伙，我问个出处还给我上保密条款", "行吧，那我猜你压根也是听来的"],
    snapshot,
  );
  assert.ok(hit.some((x) => /软拒绝|保密|栽赃|边界/.test(x)), hit.join(";"));
});

test("D2: 无人拒绝时调侃 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "y", name: "YueC", text: "出处是哪部" },
    ],
  };
  assert.deepEqual(
    softRefusalAccuseIssues(["我猜你压根也是听来的"], snapshot),
    [],
  );
});

// --- E: gloss ---

test("E1: 试岗/娅娅/3A/哈基咪 gloss", () => {
  assert.ok(speechGlosses("今天去试岗了").some((x) => /试用|试工|试岗/.test(x)));
  assert.ok(speechGlosses("娅娅表情包").some((x) => /娅娅|角色/.test(x)));
  assert.ok(speechGlosses("人都做不明白3A呢").some((x) => /3A|大作/.test(x)));
  assert.ok(speechGlosses("哈基咪又降智").some((x) => /哈基米|hajimi|哈吉米/.test(x)));
  assert.ok(speechGlosses("找接盘侠").some((x) => /接盘/.test(x)));
});

test("E2: groundingIssues 聚合纳入新闸", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    now,
    initiative: true,
    messages: [
      { id: 1, role: "user", speaker: "w", name: "雾言", text: "难受", time: now - 1000 },
    ],
  };
  const hit = groundingIssues(
    ["表情不算答案哦", "说吧，是被使唤过头了还是有人说了啥"],
    snapshot,
  );
  assert.ok(hit.some((x) => /软难受|审讯|在场/.test(x)), hit.join(";"));
});
