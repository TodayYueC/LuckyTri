import { announcesPrivacy } from "../mind/discretion.js";
import { softenRelationDenialSummaries } from "../mind/relationship-context.js";
import { isPrivateSession } from "../mind/memory.js";
import {
  conversationGrounding,
  conversationalMemory,
  socialOnlyBatch,
  recentOwnMessages,
} from "./conversation-grounding.js";
import { relevantContext } from "../mind/context-selection.js";
import { interestTerms } from "../mind/attention.js";
import { intentHint, openQuestions, priorityCues } from "./understanding.js";

// A small, factual tail after the larger memory context. It preserves message
// ownership and quote chains; it does not guess intent from isolated keywords.
export function currentExchange(snapshot) {
  const messages = snapshot.messages || [];
  const fresh = new Set(snapshot.batchIds || []);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const current = messages.filter((m) => fresh.has(m.id));
  const quoted = new Map();
  for (const message of current) {
    let id = message.replyTo?.seq ?? message.replyTo;
    const visited = new Set();
    while (byId.has(id) && !visited.has(id) && visited.size < 8) {
      visited.add(id);
      const source = byId.get(id);
      if (!fresh.has(id)) quoted.set(id, source);
      id = source.replyTo?.seq ?? source.replyTo;
    }
  }
  const media = mediaInView(snapshot);
  return {
    current,
    quoted: [...quoted.values()],
    recentOwnWords: recentOwnMessages(snapshot, 3),
    // Who owns each fresh line (image vs short reply vs text). Keeps a picture
    // from being silently titled with a neighbour's topic.
    ownership: current.map((m) => {
      const kind = messageKind(m);
      const parentId = m.replyTo?.seq ?? m.replyTo ?? m.replyChain?.[0];
      const parent = parentId != null ? byId.get(parentId) : null;
      const hint = m.role === "user" ? intentHint(m.text) : null;
      return {
        id: m.id,
        speaker: m.speaker,
        name: m.name,
        kind,
        ...(hint ? { intentHint: hint } : {}),
        ...(parent
          ? {
              repliesTo: {
                id: parent.id,
                speaker: parent.speaker,
                name: parent.name,
                text: parent.text,
              },
            }
          : {}),
      };
    }),
    ...(media.length ? { mediaInView: media } : {}),
    ...(() => {
      const docs = documentsInView(snapshot);
      return docs.length ? { documentsInView: docs } : {};
    })(),
    ...(() => {
      const qs = openQuestions(messages, snapshot.batchIds || []);
      return qs.length ? { openQuestions: qs } : {};
    })(),
    ...(() => {
      const cues = priorityCues(
        messages,
        snapshot.batchIds || [],
        snapshot.addressed?.messageIds || [],
      );
      return cues.length
        ? {
            priorityCues: cues,
            priorityNote:
              "priorityCues 是本轮开口时优先对齐的线索（叫你提问/纠正/唯一问句）。speak/react 时应点到其中之一，或明确沉默；不要只接旁边热闹支线而漏掉。",
          }
        : {};
    })(),
    // humanMessages used to mirror current's human rows and doubled the turn
    // payload (~0.7–1.5k chars) without being referenced in any prompt.
    thirdPartyClaims: current
      .filter(
        (m) =>
          conversationGrounding(snapshot).botMessageIds.includes(m.id) &&
          /(?:他|她|对方|人家)(?:指的是|说的是|意思是|是说)/.test(m.text || ""),
      )
      .map((m) => ({
        id: m.id,
        speaker: m.speaker,
        name: m.name,
        text: m.text,
        status:
          "这是当前说话人对别人的解释；须核对那个人自己的原话，不能视作本人确认",
      })),
    instruction:
      "先读本轮原话、引用和补充，确定谁在对谁说、具体问什么或表达什么；understanding.point 必须写清对方此刻意思并对齐 priorityCues / openQuestions / intentHint。同批有人认真提问或想加入时，别因后面有人刷hh或另一机器人自说自话而漏掉。人和机器人都按实际内容理解，后者的纠正没有裁定别人意思的权力。历史只用于解释这轮，不替换眼前的问题。缩写和省略从同一话题找；多个合理对象就轻问，不把自己的猜测限定成唯二选项。自己的旧话是待核对的记录，不是正确答案或说话模板。图只属于 ownership / mediaInView 标明的发送者；邻句文字话题不能自动成为别人发的图的标题。短回复优先看 repliesTo 原话，不按时间邻近另猜对象。documentsInView 标 unreadable 的文件没有打开，不要把猜测当文件内容。",
  };
}

const IMAGE_ONLY = /^(?:\[(?:图片|表情|媒体)\]\s*)+$/;

function messageKind(message) {
  const text = String(message?.text || "").trim();
  const visual = (message?.attachments || []).some((item) =>
    ["image", "mface", "market_face", "sticker"].includes(item?.type),
  );
  if (visual || IMAGE_ONLY.test(text)) return "image";
  const bare = text.replace(/\[提及成员\]|@\S+/g, "").trim();
  if (bare && bare.length <= 8) return "short";
  return "text";
}

// Pictures she can see this turn, each still attached to who sent them.
export function mediaInView(snapshot) {
  const byId = new Map((snapshot.messages || []).map((m) => [m.id, m]));
  for (const m of snapshot.messages || []) byId.set(String(m.id), m);
  const batch = new Set(snapshot.batchIds || []);
  const rows = [];
  const seen = new Set();
  const push = (messageId, description, speaker, name) => {
    const key = String(messageId);
    if (seen.has(key)) return;
    seen.add(key);
    const message = byId.get(messageId) || byId.get(key);
    rows.push({
      messageId,
      speaker: speaker ?? message?.speaker,
      name: name || message?.name || "",
      description: description || "",
      inBatch: batch.has(messageId) || batch.has(Number(messageId)),
    });
  };
  for (const obs of snapshot.vision?.observations || [])
    push(obs.messageId, obs.description, obs.speaker, obs.name);
  for (const message of snapshot.messages || []) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (messageKind(message) !== "image") continue;
    push(message.id, "", message.speaker, message.name);
  }
  return rows.filter((row) => row.speaker != null || row.description);
}

// File / html attachments she can see this turn. Readable ones carry perceived
// text; others are marked unreadable so she does not invent their contents.
export function documentsInView(snapshot) {
  const batch = new Set(snapshot.batchIds || []);
  const rows = [];
  for (const message of snapshot.messages || []) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    const files = (message.attachments || []).filter((item) =>
      ["file", "document", "html", "text"].includes(item?.type),
    );
    if (
      !files.length &&
      !/\.(?:html?|txt|md)(?:\s|$)/i.test(message.text || "")
    )
      continue;
    const perceived = (message.perceived || []).filter(Boolean);
    const name =
      files.map((f) => f.name || f.file || "").filter(Boolean)[0] ||
      String(message.text || "").slice(0, 80);
    rows.push({
      messageId: message.id,
      speaker: message.speaker,
      name: message.name || "",
      fileName: name,
      ...(perceived.length
        ? { excerpt: perceived.join(" ").slice(0, 240), readable: true }
        : { readable: false, unreadable: true }),
    });
  }
  return rows;
}

// Direct "想你了" / affection: she should answer from the relationship, not
// from a task board. Detected here so currentLife progress is not in view.
export function affectionBatch(snapshot) {
  const fresh = new Set(snapshot.batchIds || []);
  const privateChat = /(?:^|:)private:/.test(snapshot.sessionId || "");
  return (snapshot.messages || []).some(
    (m) =>
      fresh.has(m.id) &&
      m.role === "user" &&
      (m.relation === "direct" || privateChat) &&
      /(?:想你|喜欢你|爱你)/.test(m.text || ""),
  );
}

export function dialogueContext(snapshot) {
  const { sourceRows, batch, persona, ...context } = snapshot;
  const inner = { ...context.inner };
  const self = { ...context.self };
  const fresh = new Set(snapshot.batchIds || []);
  const cues = (snapshot.messages || [])
    .filter((m) => fresh.has(m.id) && m.role === "user")
    .map((m) => interestTerms([m.text]));
  const currentWords = (snapshot.messages || [])
    .filter((m) => fresh.has(m.id) && m.role === "user")
    .map((m) => m.text || "")
    .join(" ");
  const recallAsked =
    inner.continuity?.requested ||
    /刚才|之前|上次|记得|说过|答应|约定|那件|那本|那篇|进度|玩到|读到|写到|看过|读过|写过|在推|明明.{0,5}(?:玩|写|读)|(?:为什么|怎么).{0,12}(?:说|叫|喊)/.test(
      currentWords,
    );
  if (inner.continuity && !recallAsked) {
    inner.continuity = {
      ...inner.continuity,
      people: (inner.continuity.people || []).map((person) => {
        const selected = { ...person };
        for (const key of [
          "recentShared",
          "myPrivateIntentions",
          "myElsewhereWords",
          "sharedMoments",
          "memories",
        ]) {
          if (!Array.isArray(person[key])) continue;
          selected[key] = relevantContext(
            person[key].map((row) => ({
              row,
              content:
                typeof row === "string"
                  ? row
                  : row.text || row.content || JSON.stringify(row),
            })),
            {
              cues,
              limit: 3,
              requireOverlap: true,
              pinned: (item) =>
                /想你|喜欢你|爱你/.test(currentWords) &&
                /想你|喜欢你|爱你/.test(item.content) &&
                !/推游戏|写完|读完|进度|汇报|交稿|发稿|答应.{0,20}(?:玩|读|写)|承诺.{0,20}(?:玩|读|写)/.test(
                  item.content,
                ),
            },
          ).map((item) => item.row);
        }
        return selected;
      }),
    };
  }
  // In a group, what she lived in private with someone does not surface in
  // what she sees while talking; her own promises stay. Leak checks at
  // delivery still hold the line. A private thing that is not in view cannot
  // become "I can't say that here".
  const addressing = new Set(
    (snapshot.messages || [])
      .filter((m) => fresh.has(m.id) && m.relation === "direct")
      .map((m) => String(m.speaker ?? m.userId)),
  );
  if (inner.continuity && !isPrivateSession(snapshot.sessionId || ""))
    inner.continuity = {
      ...inner.continuity,
      people: (inner.continuity.people || []).map((person) => {
        // Someone talking to her directly still meets the her they know.
        if (addressing.has(String(person.id))) return person;
        const kept = { ...person };
        for (const key of [
          "recentShared",
          "myElsewhereWords",
          "sharedMoments",
          "memories",
        ])
          if (Array.isArray(person[key]))
            kept[key] = person[key].filter(
              (row) => !(row && row.privateOrigin && row.maySayAloud === false),
            );
        return kept;
      }),
    };
  const messages = snapshot.messages || [];
  const mustKeep = new Set(
    [
      ...messages.slice(-40),
      ...currentExchange(snapshot).quoted,
      ...messages.filter((m) => fresh.has(m.id)),
    ].map((m) => m.id),
  );
  const older = relevantContext(
    messages
      .filter((m) => !mustKeep.has(m.id))
      .map((m) => ({ ...m, content: m.text })),
    { cues, limit: 10, requireOverlap: true },
  );
  for (const row of older) mustKeep.add(row.id);
  context.messages = messages.filter((m) => mustKeep.has(m.id));
  // Historical compression is still accessible, selected by the current
  // topic. Unrelated weeks of old appraisals must not dominate an ordinary turn.
  for (const key of ["summaries", "stages"]) {
    if (Array.isArray(context[key]))
      context[key] = relevantContext(
        context[key].map((row) => ({ ...row, content: row.summary })),
        {
          cues,
          limit: 2,
          requireOverlap: true,
          pinned: (row) =>
            recallAsked && row.summary === context[key].at(-1)?.summary,
        },
      ).map(({ content, ...row }) => row);
  }
  context.addressConventions = (snapshot.summaries || [])
    .flatMap((row) =>
      String(row.summary || "")
        .split(/[。；\n]/)
        .filter((clause) =>
          /称呼约定|互称|私(?:下|聊).{0,12}(?:称|叫|喊)|(?:称|叫|喊).{0,12}(?:仅限|只限|私下|私聊)|宝宝.{0,8}(?:仅限|只叫|只称|只喊)|(?:希望|要求|不喜欢|别用|不要用|少用).{0,25}(?:称呼|叫|喊|开头|口吻|单字|语气)/.test(
            clause,
          ),
        )
        .map((content) => ({ period: row.period, content: content.trim() })),
    )
    .slice(-4);
  if (socialOnlyBatch(snapshot)) {
    const currentTimes = messages
      .filter((m) => fresh.has(m.id))
      .map((m) => m.time)
      .filter(Number.isFinite);
    const now = currentTimes.length ? Math.max(...currentTimes) : null;
    const quoted = new Set(currentExchange(snapshot).quoted.map((m) => m.id));
    context.messages = context.messages.filter(
      (m) =>
        fresh.has(m.id) ||
        quoted.has(m.id) ||
        (Number.isFinite(now) &&
          Number.isFinite(m.time) &&
          now - m.time <= 30 * 60000),
    );
    context.summaries = [];
    context.stages = [];
    context.memories = [];
    delete context.recalled;
    delete context.topics;
    delete inner.onMind;
    delete inner.relatedSelf;
    delete inner.with;
    delete inner.expecting;
    if (inner.state) inner.state = inner.state.replace(/（[^）]*）/g, "");
    if (inner.currentLife)
      inner.currentLife = { current: inner.currentLife.current };
  }
  if (self.here) {
    const recalled = relevantContext(
      [{ content: conversationalMemory(self.here) }],
      { cues, limit: 1, requireOverlap: true },
    );
    if (recalled.length)
      inner.placeMemory = {
        content: recalled[0].content,
        status: "过去对这个地方的印象，不是人格定义或回复规则，可以有误",
      };
    delete self.here;
  }
  // Planning reasons and prior appraisal reports are useful to the life
  // planner, but repeatedly priming ordinary speech with them creates scripts.
  delete inner.stood;
  delete inner.will;
  livedView(inner, self);
  // Ordinary turns: only keep justLived lines that overlap the current cue;
  // otherwise drop them so other-room life does not steal the reply.
  if (inner.justLived?.lines) {
    const cueTerms = interestTerms([currentWords]);
    inner.justLived = {
      note: "你刚在别的群聊里经历的事。只有和眼前话题有关时才顺口提一句背景。",
      lines: inner.justLived.lines.filter((line) =>
        [...interestTerms([line.text || ""])].some(
          (term) => term.length >= 2 && cueTerms.has(term),
        ),
      ),
    };
    if (!inner.justLived.lines.length) delete inner.justLived;
  }
  const worn = wornPhrases(snapshot.messages || []);
  if (worn.length)
    context.working = {
      ...(context.working || {}),
      worn: {
        phrases: worn,
        note: "这些是你最近说得太多的词，这次换成你自己平常的说法",
      },
    };
  if (affectionBatch(snapshot)) {
    // Affection first: keep only that she is still herself. Drop progress,
    // justLived's "顺口给句背景", and livingFor wishes so a "想你了" is not
    // answered with a reading report or a work-volume question.
    delete inner.currentLife;
    delete inner.justLived;
    if (self) delete self.livingFor;
    if (inner.selfKnown && typeof inner.selfKnown === "object") {
      const { livingFor: _wish, ...rest } = inner.selfKnown;
      inner.selfKnown = rest;
    }
  } else if (inner.currentLife) {
    const life = inner.currentLife;
    const compact = (row) => ({
      id: row.id,
      title: row.title,
      state: row.state,
      ...(row.wait ? { wait: row.wait } : {}),
      ...(row.plannedFor ? { plannedFor: row.plannedFor } : {}),
    });
    inner.currentLife = {
      ...life,
      pending: (life.pending || []).map(compact),
      intentions: (life.intentions || []).map(compact),
      worksCoverage:
        "以下是按本轮话题选出的作品片段，不是全部历史；缺少一篇不能证明从未写过或读过。",
    };
  }
  if (Array.isArray(context.summaries))
    context.summaries = softenRelationDenialSummaries(
      context.summaries,
      inner.relationships,
    );
  const media = mediaInView(snapshot);
  return {
    ...context,
    self,
    inner,
    grounding: conversationGrounding(snapshot),
    ...(media.length
      ? {
          vision: {
            observations: media.map((row) => ({
              messageId: row.messageId,
              speaker: row.speaker,
              name: row.name,
              description: row.description,
            })),
          },
        }
      : {}),
  };
}

// Only an unambiguous, addressed stop in the latest human message. Quoted
// dialogue, ordinary venting and a later renewed question do not match.
export function explicitStop(snapshot) {
  if (snapshot.initiative) return false;
  const latest = (snapshot.messages || [])
    .filter(
      (m) => m.role === "user" && (snapshot.batchIds || []).includes(m.id),
    )
    .at(-1);
  if (
    !latest ||
    !(
      latest.relation === "direct" ||
      snapshot.addressed?.messageIds?.includes(latest.id) ||
      /(?:^|:)private:/.test(snapshot.sessionId || "")
    )
  )
    return false;
  const words = String(latest.text || "")
    .replace(/\[提及成员\]|@我/g, "")
    .trim();
  return /^(?:请|麻烦|先|你|给我|你给我|现在)?(?:闭嘴|别说了|不要再说了|别再说了|别问了|先别说话|别聊这个了)[。！!，,\s]*$/.test(
    words,
  );
}

// What she carries into a conversation is how she is, not her bookkeeping.
// Rules she once wrote for herself ("I don't answer broken sentences"),
// self-defending opinions, notes about failed images and the planner's
// schedule all made her talk like a clerk; the planner and reflection still
// read them where they are kept. Lines she lived elsewhere in public are
// simply her recent life, without a "may not say" flag that she read as
// "I hold secrets here".
const RULE_LIKE =
  /不接|不回|要换|还挂着|没被碰到|规矩|必须|只能|不能|不该|没义务|别人没|验收|记账|账|并案|顺延/;
const FAILURE_NOTE =
  /图.{0,6}(?:接不上|读不出|没读|打不开)|接不上图|没读出|读不出|打不开|看不到图/;
export function livedView(inner, self = {}) {
  if (inner.justLived?.lines) {
    inner.justLived = {
      note: "你刚在别的群聊里经历的事，是你自己的近况。这里的人没看到，提起时顺口给句背景就行。",
      lines: inner.justLived.lines
        .filter(
          (line) =>
            line.text !== "你们刚刚私下说过话" &&
            !announcesPrivacy([line.text]),
        )
        .map(({ maySayAloud: _flag, ...line }) => line),
    };
    if (!inner.justLived.lines.length) delete inner.justLived;
  }
  const known = inner.selfKnown;
  if (known && typeof known === "object") {
    const { note: _note, livingFor, ...rest } = known;
    inner.selfKnown =
      livingFor && !RULE_LIKE.test(livingFor) ? { ...rest, livingFor } : rest;
  }
  if (Array.isArray(inner.relatedSelf)) {
    inner.relatedSelf = inner.relatedSelf.filter(
      (line) => !RULE_LIKE.test(line),
    );
    if (!inner.relatedSelf.length) delete inner.relatedSelf;
  }
  if (Array.isArray(inner.with)) {
    inner.with = inner.with
      .map((line) =>
        String(line).replace(
          /[^：:，,]*?(?:接不上|读不出|没读出)[^，,]*[，,]?/g,
          "",
        ),
      )
      .filter((line) => line && !FAILURE_NOTE.test(line));
    if (!inner.with.length) delete inner.with;
  }
  if (typeof inner.state === "string")
    inner.state = inner.state.replace(
      /（[^）]*(?:图|接不上|读不出)[^）]*）/g,
      "",
    );
  if (
    self &&
    typeof self.livingFor === "string" &&
    RULE_LIKE.test(self.livingFor)
  )
    delete self.livingFor;
  return inner;
}

// Her own recent habits, counted from what she actually said. Another bot's
// lines are not counted: they are someone else's voice.
const WORN = [
  ["账", /账/],
  ["认了/认下", /认(?:了|下|一半|账)/],
  ["验收", /验收/],
  ["说来听听", /说来听听/],
  ["确实", /确实/],
  ["具体", /具体/],
  ["后半句", /后半句/],
  ["挂着", /挂着/],
];
export function wornPhrases(messages) {
  const mine = messages
    .filter((m) => m.role === "assistant")
    .slice(-12)
    .map((m) => m.text || "");
  if (mine.length < 3) return [];
  return WORN.filter(
    ([, pattern]) => mine.filter((line) => pattern.test(line)).length >= 2,
  ).map(([word]) => word);
}
