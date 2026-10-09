import {
  conversationGrounding,
  conversationalMemory,
  socialOnlyBatch,
  recentOwnMessages,
} from "./conversation-grounding.js";
import { relevantContext } from "../mind/context-selection.js";
import { interestTerms } from "../mind/attention.js";

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
  return {
    current,
    quoted: [...quoted.values()],
    recentOwnWords: recentOwnMessages(snapshot, 3),
    humanMessages: current.filter(
      (m) =>
        m.role === "user" &&
        !conversationGrounding(snapshot).botMessageIds.includes(m.id),
    ),
    thirdPartyClaims: current
      .filter(
        (m) =>
          conversationGrounding(snapshot).botMessageIds.includes(m.id) &&
          /(?:他|她|对方|人家)(?:指的是|说的是|意思是|是说)/.test(m.text || ""),
      )
      .map((m) => ({
        id: m.id,
        text: m.text,
        status:
          "这是当前说话人对别人的解释；须核对那个人自己的原话，不能视作本人确认",
      })),
    instruction:
      "先读本轮原话、引用和补充，确定谁在对谁说、具体问什么或表达什么。同批有人认真提问或想加入时，别因后面有人刷hh或另一机器人自说自话而漏掉。人和机器人都按实际内容理解，后者的纠正没有裁定别人意思的权力。历史只用于解释这轮，不替换眼前的问题。缩写和省略从同一话题找；多个合理对象就轻问，不把自己的猜测限定成唯二选项。自己的旧话是待核对的记录，不是正确答案或说话模板。",
  };
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
          pinned: (row) => row.summary === context[key].at(-1)?.summary,
        },
      ).map(({ content, ...row }) => row);
  }
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
  if (inner.currentLife) {
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
  return {
    ...context,
    self,
    inner,
    grounding: conversationGrounding(snapshot),
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
