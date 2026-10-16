import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import { currentExchange } from "../server/core/dialogue-context.js";
import { priorityCues } from "../server/core/understanding.js";
import {
  actionNote,
  ActionLedger,
  chosenActions,
  performActions,
} from "../server/actions/index.js";
import {
  musicCardHint,
  musicReadyState,
  MUSIC_DEFAULTS,
} from "../server/channels/onebot/music-settings.js";

// --- U4: priorityCues in exchange ---

test("U4: addressed 问句进入 priorityCues / exchange", () => {
  const snapshot = {
    batchIds: [1, 2],
    addressed: { messageIds: [2] },
    messages: [
      { id: 1, role: "user", speaker: "a", text: "存货见底了哈哈" },
      {
        id: 2,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 在计算机组成原理中，为什么指令流水线能提高吞吐率？",
      },
    ],
  };
  const cues = priorityCues(
    snapshot.messages,
    snapshot.batchIds,
    snapshot.addressed.messageIds,
  );
  assert.ok(cues.some((c) => c.messageId === 2 && c.addressed));
  const exchange = currentExchange(snapshot);
  assert.ok(exchange.priorityCues?.some((c) => c.messageId === 2));
  assert.match(exchange.instruction, /priorityCues/);
});

// --- U1: multi-thread miss ---

test("U1: 旧支线玩笑盖住 addressed 问句 → ledger issue", () => {
  const snapshot = {
    batchIds: [10, 11],
    addressed: { messageIds: [11] },
    messages: [
      { id: 10, role: "user", speaker: "a", text: "我说你换个梯子的国家" },
      {
        id: 11,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 在计算机组成原理中，为什么指令流水线能提高指令吞吐率？",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["搜中国可还行，万一搜出来个中国特供版扣款页面呢"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "other",
        point: "还在聊换梯子国家的玩笑",
        messageIds: [10],
      },
      targetMessageIds: [10],
    },
  );
  assert.ok(
    bad.some((x) => /优先|支线|提问/.test(x)),
    bad.join(" | "),
  );
});

// --- U2: hit and answer ---

test("U2: 点到优先问句并答到 → 无多线程 issue", () => {
  const snapshot = {
    batchIds: [11],
    addressed: { messageIds: [11] },
    messages: [
      {
        id: 11,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 为什么指令流水线能提高吞吐率，却不一定缩短单条执行时间？",
      },
    ],
  };
  const ok = understandingLedgerIssues(
    [
      "流水线是把多条指令叠着做，所以吞吐上去了；单条还是要走完各级，时间不一定更短。",
    ],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "问流水线为何提高吞吐却不一定缩短单条时间",
        messageIds: [11],
      },
      targetMessageIds: [11],
    },
  );
  assert.equal(
    ok.filter((x) => /优先|支线|提问的具体内容/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

// --- U3: wrong branch zero overlap ---

test("U3: 点到「tg是什么」却只回玩偶 → issue", () => {
  const snapshot = {
    batchIds: [10],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "comma",
        text: "牢大 tg 是什么",
        attachments: [{ type: "image" }],
      },
    ],
  };
  const bad = groundingIssues(["妙脆角玩偶挺配的，哈哈"], snapshot, {
    choice: "speak",
    understanding: {
      kind: "question",
      point: "问 tg 是什么",
      messageIds: [10],
    },
    targetMessageIds: [10],
  });
  assert.ok(bad.some((x) => /问题|优先|具体内容|理解/.test(x)), bad.join(" | "));
});

test("U3b: point 空壳被拦", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        relation: "direct",
        text: "[提及成员] 怎么扫不了这个码",
      },
    ],
  };
  const issues = understandingLedgerIssues(["嗯"], snapshot, {
    choice: "speak",
    understanding: { kind: "question", point: "对方在问", messageIds: [1] },
    targetMessageIds: [1],
  });
  assert.ok(issues.some((x) => /空壳|具体|优先|问题/.test(x)), issues.join(" | "));
});

// --- E1: actions ---

test("E1: actionsNote 中性；戳限额 2；回戳豁免", () => {
  const note = actionNote(["poke", "react"]);
  assert.match(note.actionsNote, /合适就用/);
  assert.doesNotMatch(note.actionsNote, /不用为用而用/);

  const ledger = new ActionLedger(null, { now: () => 1_000_000 });
  // without db, count returns 0 — exercise reciprocal flag API
  assert.equal(ledger.allowed("s", "poke", "u1"), true);
  assert.equal(ledger.allowed("s", "poke", "u1", { reciprocalPoke: true }), true);

  const snapshot = {
    batchIds: [1],
    actionsOffered: ["poke"],
    canAt: [{ userId: "u1", name: "甲" }],
    messages: [
      { id: 1, role: "user", speaker: "u1", name: "甲", poke: true, text: "[戳了戳你]" },
    ],
  };
  const chosen = chosenActions([{ type: "poke", to: "u1" }], snapshot);
  assert.equal(chosen[0]?.reciprocal, true);
});

test("E1b: performActions 回戳跳过限额", async () => {
  const calls = [];
  const owner = {
    perform: async (_m, action) => {
      calls.push(action.type);
    },
    actions: {
      allowed(session, type, target, opts = {}) {
        if (type === "poke" && !opts.reciprocalPoke) return false;
        return true;
      },
      record() {},
    },
  };
  const blocked = await performActions(
    owner,
    {},
    [{ type: "poke", to: "u1" }],
    { steps: [] },
    "s",
  );
  assert.equal(blocked.length, 0);
  const ok = await performActions(
    owner,
    {},
    [{ type: "poke", to: "u1", reciprocal: true }],
    { steps: [] },
    "s",
  );
  assert.equal(ok.length, 1);
  assert.deepEqual(calls, ["poke"]);
});

// --- M1: music ready ---

test("M1: music hint 含步骤；ready 状态", () => {
  const hint = musicCardHint(MUSIC_DEFAULTS);
  assert.match(hint, /步骤|WebUI|签名/);
  assert.equal(musicReadyState(MUSIC_DEFAULTS).ready, "needs_sign");
  assert.equal(
    musicReadyState({ ...MUSIC_DEFAULTS, musicSignUrl: "http://x" }).ready,
    "ok",
  );
  assert.equal(
    musicReadyState(MUSIC_DEFAULTS, { degraded: "link", status: "sent" }).ready,
    "degraded_link",
  );
});

import { SEARCH_DEFAULTS } from "../server/mind/time/search.js";
import { world } from "./helpers/world.js";

test("S1: DeepSeek public.keySource own|reuse|none", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({
    provider: "deepseek",
    apiKey: "",
    clearKey: true,
    reuseChatKey: false,
    enabled: true,
  });
  assert.equal(search.public().keySource, "none");
  search.save({ apiKey: "sk-search-own", reuseChatKey: false });
  assert.equal(search.public().keySource, "own");
  w.store.db
    .prepare(
      "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .run(
      "models",
      JSON.stringify([
        {
          id: "ds-chat",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKey: "chat-secret-key",
          model: "deepseek-flash",
        },
      ]),
    );
  search.save({ apiKey: "", clearKey: true, reuseChatKey: true });
  assert.equal(search.public().keySource, "reuse");
  assert.equal(SEARCH_DEFAULTS.provider, "tavily");
});
