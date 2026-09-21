import { captureMemoryCandidate } from "./memory.js";
import { generateReply, demoReply } from "./voice.js";
import { isNameCall } from "./core/name-call.js";
import { callModel } from "./core/llm.js";
export { emotionOf } from "./voice.js";
export { normalize } from "./channels/onebot.js";
export { isNameCall, callModel };
export const extensions = {
  beforeDecision: [],
  afterReply: [],
  imageUnderstanding: null,
  stickerProvider: null,
  proactiveScheduler: null,
};

const contextReplyOpeners =
  /^(?:嗯+|哦+|噢+|啊+|唉+|诶+|欸+|对(?:的|啊|吧)?|就是(?:啊|了)?|是的?|不是(?:吧|啊|的)?|确实|还真|没办法|可不|可不是|有道理|行(?:啊|吧|呀)?|好(?:的|吧|呀)?|谢谢|多谢|哈哈+|笑死|草|[？?]+|那(?:就|我|你|是|也)|所以|然后|但是|不过|可是|为啥|为什么|咋办|怎么会|你说(?:得|的)(?:对)?|你刚才|刚刚你|我也|我倒是|原来|懂了|明白了|收到|不至于|没错)(?=$|[\s，。！？!?：:、])/i;
const contextNewTopicOpeners =
  /^(?:话说|对了|顺便|另外|有没有人|谁知道|求问|问一下|请问|各位|大家|今天|明天|刚刚|我想问|有个问题)/;
const contextStopOpeners =
  /^(?:不用回|别回|不想聊|我先去睡|我先去洗澡|晚安|先撤)/;
const contextStopWords = new Set([
  "这个",
  "那个",
  "真的",
  "就是",
  "然后",
  "感觉",
  "还是",
  "现在",
  "怎么",
  "我们",
  "你们",
  "一下",
  "可以",
  "有点",
  "没有",
  "不是",
  "自己",
  "大家",
  "事情",
  "哈哈",
]);

function contextTerms(text) {
  const terms = new Set();
  const source = String(text || "")
    .replace(/\[(?:图片|表情|媒体|提及成员|回复你|叫了你一声)\]/g, " ")
    .match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9]{2,}/g);
  for (const phrase of source || []) {
    if (!contextStopWords.has(phrase)) terms.add(phrase);
    if (/^[\u4e00-\u9fff]+$/.test(phrase))
      for (let i = 0; i + 1 < phrase.length; i++) {
        const pair = phrase.slice(i, i + 2);
        if (!contextStopWords.has(pair)) terms.add(pair);
      }
  }
  return terms;
}

function sharesContextTerms(a, b) {
  const right = contextTerms(b);
  return [...contextTerms(a)].some((term) => right.has(term));
}

// A short continuation can still belong to the conversation between two other
// members. Keep that target explicit so the model does not mistake every
// sentence after an LuckyBot reply for a reply to LuckyBot.
export function conversationTargetHint(message, rows = []) {
  if (!message || message.kind !== "group") return null;
  const text = String(message.text || "").trim();
  if (/^\[提及成员\]/.test(text))
    return {
      hardStop: true,
      reason: "这条 @ 的是其他群友，先不自我代入",
      hint: "本条的 @ 指向其他群友，不是 LuckyBot。",
    };
  const previous = Array.isArray(rows)
    ? rows
        .slice(0, -1)
        .filter(
          (row) =>
            row.role === "user" &&
            String(row.user_id || row.userId) === String(message.userId),
        )
        .slice(-3)
    : [];
  const otherConversation = previous
    .slice(-1)
    .some((row) =>
      /\[提及成员\]|你看[他她]|跟.+(?:说|聊)|对.+说/.test(
        String(row.text || ""),
      ),
    );
  if (otherConversation && Array.from(text).length <= 28)
    return {
      hardStop: false,
      reason: "沿着群友之间的话题，先不自我代入",
      hint: "当前发言者前面在讨论其他成员；本条像是在继续那条对话，不要把省略主语自动理解成在对 LuckyBot 说。",
    };
  return null;
}

export function contextReplyAssessment(message, rows = [], now = Date.now()) {
  if (!message || message.kind !== "group")
    return { confidence: "none", priority: false, score: 0, reason: "非群聊" };
  if (message.mentioned || message.replyToBot || message.nameCall)
    return {
      confidence: "none",
      priority: false,
      score: 0,
      reason: "已经明确叫到机器人",
    };
  const text = String(message.text || "").trim();
  if (!text || /\[提及成员\]/.test(text))
    return {
      confidence: "none",
      priority: false,
      score: 0,
      reason: "没有对准机器人",
    };
  const previous = Array.isArray(rows) ? rows.at(-2) : null;
  if (!previous || previous.role !== "assistant" || previous.user_id !== "bot")
    return {
      confidence: "none",
      priority: false,
      score: 0,
      reason: "上一条不是机器人发言",
    };
  const elapsed = Number.isFinite(Number(previous.time))
    ? Math.max(0, Number(now) - Number(previous.time))
    : 0;
  if (elapsed > 120000)
    return {
      confidence: "none",
      priority: false,
      score: 0,
      reason: "间隔太久",
    };
  const overlap = sharesContextTerms(previous.text, text),
    previousQuestion = /[？?]\s*$/.test(String(previous.text || "")),
    responseOpener = contextReplyOpeners.test(text),
    stop = contextStopOpeners.test(text),
    newTopic =
      contextNewTopicOpeners.test(text) &&
      !responseOpener &&
      !overlap &&
      !previousQuestion;
  if (stop || newTopic)
    return {
      confidence: "none",
      priority: false,
      score: 0,
      reason: "收口或开启新话题",
    };
  let score = 0;
  if (responseOpener) score += 2;
  if (overlap) score += 2;
  if (previousQuestion) score++;
  const recentShort = elapsed <= 45000 && Array.from(text).length <= 42;
  const priority = score >= 2;
  return {
    confidence: priority
      ? "high"
      : score > 0 || recentShort
        ? "possible"
        : "none",
    priority,
    score,
    reason: priority
      ? "高置信度接续上一条机器人发言"
      : "可能接续上一条机器人发言",
  };
}

export function naturalReplyDelayMs(message, reply, random = Math.random) {
  const direct =
      message?.kind === "private" ||
      message?.mentioned ||
      message?.replyToBot ||
      message?.nameCall ||
      message?.contextAddressed?.confidence === "high" ||
      message?.contextAddressed === true,
    chars = Math.min(70, Array.from(String(reply || "")).length),
    base = direct ? 900 : 1300,
    typing = Math.min(1700, Math.max(0, chars - 1) * 24),
    jitter = Math.floor(Math.max(0, Math.min(1, random())) * 550);
  return Math.min(4200, base + typing + jitter);
}

export function boundedContext(rows, budget = 16000) {
  const kept = [];
  for (const row of [...rows].reverse()) {
    if (budget <= 0) break;
    const text = Array.from(row.text).slice(-budget).join("");
    kept.unshift({
      speaker: row.user_id,
      name: row.name,
      text,
      role: row.role,
    });
    budget -= Array.from(text).length;
  }
  return kept;
}
/** @deprecated 发言路径已并入 ChatSystem；本类不再用于生产发送。 */
export class Engine {
  constructor(
    store,
    send,
    {
      model = callModel,
      random = Math.random,
      now = Date.now,
      delay = async () => {},
    } = {},
  ) {
    Object.assign(this, { store, send, model, random, now, delay });
    this.busy = new Set();
  }
  async receive(m) {
    const { store } = this;
    const db = store.db;
    const s = store.sessionSettings(m.sessionId);
    const revision = store.revision;
    const demo = Number(!!m.simulated);
    const lane = `${demo}:${m.sessionId}`;
    db.prepare(
      "INSERT OR IGNORE INTO sessions(id,name,kind) VALUES (?,?,?)",
    ).run(
      m.sessionId,
      m.kind === "group" ? `群聊 ${m.nativeId || m.sessionId}` : m.name,
      m.kind,
    );
    const seen = db
      .prepare("INSERT OR IGNORE INTO seen_events(event_id,time) VALUES (?,?)")
      .run(m.eventId, this.now());
    if (!seen.changes) return { reason: "重复消息" };
    const insert = db
      .prepare(
        "INSERT OR IGNORE INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        m.eventId,
        m.sessionId,
        m.userId,
        m.name,
        m.text,
        this.now(),
        "user",
        demo,
      );
    if (!insert.changes) return { reason: "重复消息" };
    store.trimContext(m.sessionId, demo);
    const stop = (reason, emotion = "—") => {
      store.log(m.sessionId, emotion, reason, "", demo);
      return { reason, emotion };
    };
    if (
      !s.enabled ||
      !db.prepare("SELECT enabled FROM sessions WHERE id=?").get(m.sessionId)
        .enabled
    )
      return stop("会话已暂停");
    if (s.demo && !m.simulated) return stop("模拟模式不发送 QQ 消息");
    if (!s.demo && m.simulated) return stop("请先开启模拟模式");
    if (!demo && s.memoryEnabled && s.memoryCandidates)
      captureMemoryCandidate(store, m);
    const nameCall = isNameCall(m.text, [
      s.name,
      ...String(s.aliases || "").split(/[,，]/),
    ]);
    const explicitDirect = m.kind === "private" || m.mentioned || nameCall;
    const contextRows = store.context(m.sessionId, s.contextLimit, demo);
    const contextAddressed = contextReplyAssessment(
      { ...m, nameCall },
      contextRows,
      this.now(),
    );
    const direct = explicitDirect || contextAddressed.priority;
    const conversationTarget = conversationTargetHint(
      { ...m, nameCall },
      contextRows,
    );
    // An explicit @/reply/name call wins; a weak "continuation after the bot"
    // signal must not override evidence that this member is talking to someone else.
    if (conversationTarget?.hardStop && !explicitDirect)
      return stop(conversationTarget.reason);
    if (m.kind === "group" && m.media?.only && !direct)
      return stop("图片或表情刷屏，先不抢话");
    if (this.busy.has(lane)) return stop("正在听，避免连续抢话");
    const last = db
      .prepare(
        "SELECT MAX(time) time FROM send_attempts WHERE session_id=? AND is_demo=?",
      )
      .get(m.sessionId, demo).time;
    if (
      last != null &&
      this.now() - last < s.cooldown * 1000 &&
      !contextAddressed.priority
    )
      return stop("发言冷却中");
    const rateLimited = () =>
      db
        .prepare(
          "SELECT COUNT(*) n FROM send_attempts WHERE is_demo=? AND time>?",
        )
        .get(demo, this.now() - 60000).n >= 6;
    if (rateLimited()) return stop("全局发言限速");
    if (!direct && this.random() >= s.probability) return stop("这句话先听着");
    // Reaching this point means the ordinary-message participation sample passed.
    // Tell the model explicitly so the configured probability is not applied twice
    // by a prompt that is overly cautious about staying silent.
    const ordinarySampled = !direct;
    if (this.busy.size >= 3) return stop("同时参与的话题较多，先听着");
    this.busy.add(lane);
    try {
      for (const hook of extensions.beforeDecision) await hook(m);
      const memories = s.memoryEnabled
        ? db
            .prepare(
              "SELECT content FROM memories WHERE user_id=? AND (scope='shared' OR (scope='private' AND ?='private') OR scope=?) ORDER BY id DESC LIMIT 15",
            )
            .all(m.userId, m.kind, m.sessionId)
        : [];
      const input = {
        message: { ...m, nameCall, contextAddressed, conversationTarget },
        direct,
        explicitDirect,
        contextAddressed,
        conversationTarget,
        ordinarySampled,
        participationProbability: s.probability,
        memories,
        feedback: store.feedback(m.sessionId, demo),
        groupStyle:
          s.adaptGroupStyle && m.kind === "group"
            ? store.groupStyle(m.sessionId, demo)
            : null,
        context: boundedContext(contextRows),
      };
      const result = s.demo
        ? demoReply(s, input, this.random)
        : await generateReply(s, input, this.model);
      if (!result.speak) return stop(result.reason, result.emotion);
      const reply = result.reply; // quality check enforces the bound; never cut a sentence mid-thought
      await this.delay({ ...m, nameCall, contextAddressed }, reply, result);
      const current = store.settings();
      if (
        !current.enabled ||
        !db.prepare("SELECT enabled FROM sessions WHERE id=?").get(m.sessionId)
          ?.enabled ||
        current.demo !== s.demo ||
        store.revision !== revision
      )
        return stop("配置变更，取消发送");
      if (rateLimited()) return stop("全局发言限速");
      // Persist before sending: uncertain delivery still consumes cooldown after restart.
      const attempt = db
        .prepare(
          "INSERT INTO send_attempts(session_id,is_demo,time,status) VALUES (?,?,?,'pending')",
        )
        .run(m.sessionId, demo, this.now());
      try {
        await this.send(m, reply);
        db.prepare(
          "UPDATE send_attempts SET status='confirmed',time=? WHERE id=?",
        ).run(this.now(), attempt.lastInsertRowid);
      } catch (error) {
        db.prepare(
          "UPDATE send_attempts SET status='uncertain' WHERE id=?",
        ).run(attempt.lastInsertRowid);
        throw error;
      }
      db.prepare(
        "INSERT INTO messages(session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?)",
      ).run(m.sessionId, "bot", s.name, reply, this.now(), "assistant", demo);
      store.trimContext(m.sessionId, demo);
      store.log(
        m.sessionId,
        result.emotion,
        result.reason + (result.quality?.rewritten ? "（已调整口吻）" : ""),
        reply,
        demo,
      );
      for (const hook of extensions.afterReply) {
        try {
          await hook(m, reply);
        } catch {
          store.log(
            m.sessionId,
            "扩展错误",
            "回复已发送，后置扩展执行失败",
            "",
            demo,
          );
        }
      }
      return { ...result, reply };
    } catch (error) {
      store.log(m.sessionId, "错误", error.message, "", demo);
      return { error: error.message };
    } finally {
      this.busy.delete(lane);
    }
  }
}
