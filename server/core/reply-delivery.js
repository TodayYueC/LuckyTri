import { typedAt } from "../stickers/offer.js";
import { persistReply } from "./message-manager.js";
import { PRIVATELY_KNOWN } from "../mind/discretion.js";
import { replyFocus } from "./conversation-cues.js";

// How long a finished reply may wait for its reviews.
export const DEEP_CHECK_DEADLINE_MS = 40000;
export const GROUP_CHECK_DEADLINE_MS = 15000;
import { replyPrompt } from "./persona-manager.js";
import { actionLine, performActions } from "../actions/index.js";
import {
  speakable,
  synthesize,
  voiceOffered,
  voiceSettings,
} from "../voice/index.js";
import { turnModel } from "./turn.js";
import { generate } from "./response-generator.js";
import {
  contradictoryOwnWords,
  normalizeResponse,
  reviewContext,
  validateResponse,
} from "./response-validator.js";
import { deliver, sleep } from "./message-scheduler.js";
import { leaks } from "../mind/guard.js";
import { isGroupSession } from "../channels/session-key.js";
import { interestTerms } from "../mind/attention.js";
import {
  bubblePreference,
  conversationGrounding,
} from "./conversation-grounding.js";
import { initiativeAudience } from "../mind/conversation-origin.js";
import {
  readerQuestions,
  readerCheckPrompt,
  readerVerdict,
  INTENT_CHECK,
} from "./reader-check.js";
import { currentExchange } from "./dialogue-context.js";
import {
  claimsLivedAction,
  EXPRESSION_GROUNDING,
} from "../mind/expression-grounding.js";

const replyFormatFeedback =
  /(?:看着|看起来|读起来).{0,8}(?:累|太长|太多)|(?:你|你们).{0,12}(?:可以|能不能|别|不要).{0,12}(?:一段|一条|一句|合在一起|拆|少发|少说)|(?:一小节|一段|一条|一句).{0,12}(?:发|说|回|拆|累)|(?:太抽象|太人机|太机械|复读|看不懂|说人话|别拆|不要拆)/;
function isFormatError(error) {
  return (
    error instanceof SyntaxError ||
    /JSON|Unexpected token|格式|气泡|bubbles|choice|输出被截断/i.test(
      error?.message || "",
    )
  );
}

export function filterTranscriptContradictedIssues(issues, snapshot) {
  const messages = (snapshot.messages || []).filter(
    (message) => message.role === "user",
  );
  const transcriptTerms = interestTerms(
    messages.map((message) => message.text),
  );
  const absentEvidence =
    /(?:当前|现有|此前|前文|对话|上下文|原话|原文|消息|记录).{0,20}(?:没有|未|并没有|不在)|(?:没有|并没有|未|无人).{0,24}(?:这句话|这句|提到|说过|出现|提供|给出|片段|原文|上下文|记录)/u;
  const quotedPhrases = (issue) => {
    const phrases = [];
    for (const [open, close] of [
      ["“", "”"],
      ["‘", "’"],
      ["「", "」"],
      ["『", "』"],
      ['"', '"'],
    ]) {
      let from = 0;
      while (from < issue.length) {
        const start = issue.indexOf(open, from);
        if (start < 0) break;
        const end = issue.indexOf(close, start + open.length);
        if (end < 0) break;
        const phrase = issue.slice(start + open.length, end).trim();
        if (phrase.length >= 3) phrases.push(phrase);
        from = start + open.length;
      }
    }
    return phrases;
  };
  return (issues || []).filter((issue) => {
    if (!absentEvidence.test(issue)) return true;
    return !quotedPhrases(issue).some((phrase) => {
      if (messages.some((message) => (message.text || "").includes(phrase)))
        return true;
      const terms = interestTerms([phrase]);
      return [...terms].filter((term) => transcriptTerms.has(term)).length >= 2;
    });
  });
}

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class ReplyDelivery {
  constructor(owner) {
    this.owner = owner;
  }
  async speak(c) {
    const {
      session,
      batch,
      turn,
      snapshot,
      trace,
      finish,
      models,
      model,
      nature,
      prompt,
      policy,
    } = c;
    // A group moment nobody called her into is rewritten and reviewed at the
    // same quick effort as its turn: the slow path missed the moment
    // (round 24 replays: group p90 over 50 s).
    // Being called by name keeps the turn itself at full effort; checking
    // and rewriting the words is a reading task and runs quick in any group.
    const quickModel = turnModel(model, {
      group: !c.privateChat,
      direct: policy.quickGroupReview === false ? !!c.direct : false,
      policy,
    });
    const targetUsers = new Set(
      snapshot.messages
        .filter((m) => turn.targetMessageIds.includes(m.id))
        .map((m) => m.speaker),
    );
    const newerUserMessages = () =>
      this.owner.repo
        .eventsAfter(session, c.watermark, { simulated: c.simulatedTurn })
        .filter((m) => m.role === "user");
    const hasRelevantUpdate = () =>
      newerUserMessages().some(
        (m) =>
          c.privateChat ||
          targetUsers.has(m.userId) ||
          m.relation === "direct" ||
          (m.replyId &&
            snapshot.batch.some((b) => b.platformId === m.replyId)) ||
          replyFormatFeedback.test(m.text || ""),
      );
    const audienceCurrent = () =>
      !snapshot.initiative ||
      initiativeAudience(
        this.owner.mind,
        {
          sources: snapshot.initiative.expression?.sources || [],
          created: snapshot.initiative.expression?.formedAt,
        },
        session,
        this.owner.now(),
      ).allowed;
    const isCurrent = () =>
      !this.owner.queue.closed &&
      (c.preview ||
        this.owner.enabled(session, { simulated: c.simulatedTurn })) &&
      this.owner.sessionState(session) === c.state &&
      !hasRelevantUpdate() &&
      audienceCurrent();
    const staleExit = () => {
      if (!audienceCurrent())
        trace.steps.push("话题来源或参与者已改变，这份旧稿未继续发送");
      if (newerUserMessages().length)
        trace.steps.push("新消息已进入下一批，取消旧稿");
      if (
        hasRelevantUpdate() &&
        c.clearEpoch === (this.owner.clearEpoch.get(session) || 0)
      )
        this.owner.queue.retain(session, batch);
      return finish("stale", "生成期间语境已更新，旧稿未发送");
    };
    const outdated = () => !c.replay && !c.preview && !isCurrent();
    const focus = replyFocus(snapshot, turn).kind;
    const fallbackOptions = [
      ...(focus === "acknowledge" ? ["嗯。", "好。"] : []),
      ...(focus === "readability_repair"
        ? ["刚才那句我没说清楚，先不继续绕了。"]
        : []),
      ...(focus === "promise_check"
        ? ["你问的约定我得认真核对，刚才我没接住。", "我先认真核对一下。"]
        : []),
      ...(snapshot.batch.some((m) =>
        /^(?:你)?(?:还)?在(?:吗|不在)[？?\s]*$/.test(m.text || ""),
      )
        ? ["在。"]
        : []),
      // When what went wrong is that she holds someone's private thing, the
      // honest short line is that she will not tell it here, not "I'm unsure".
      ...(holdsPrivate(snapshot) ? ["这是别人私下的事，我不在这儿讲。"] : []),
      "这句我还没理清楚，先不乱说。",
      "我还没想明白。",
    ];
    const fallbackText = turn.crisis?.clear
      ? "你现在还好吗？身边有人能陪着你吗？"
      : snapshot.initiative
        ? ""
        : fallbackOptions.find(
            (text) =>
              !(nature.forbidden || []).some((word) => text.includes(word)) &&
              !snapshot.messages
                .filter((m) => m.role === "assistant")
                .slice(-12)
                .some((m) => m.text === text),
          ) || "我还没想明白。";
    const generationPrompt = replyPrompt(
      nature,
      prompt,
      snapshot.initiative ? "initiative" : "generation",
    );
    const makeResponse = async (issues = [], draft = null, plain = false) => {
      try {
        const raw = await generate(
          models,
          quickModel,
          generationPrompt,
          snapshot,
          draft ? { ...turn, bubbles: draft.bubbles } : turn,
          trace,
          c.generationImages,
          issues,
          { plain },
        );
        return normalizeResponse(
          raw,
          {
            ...turn,
            maxBubbles:
              bubblePreference(snapshot) === "single" ? 1 : turn.maxBubbles,
          },
          fallbackText,
        );
      } catch (error) {
        if (!isFormatError(error)) throw error;
        if (snapshot.initiative) throw error;
        trace.steps.push("模型回复格式异常，已使用本地短句兜底");
        return { bubbles: [fallbackText], reason: "本地短句兜底" };
      }
    };
    const secrets = this.owner.mind.memory.secretsOutside(session);
    const privateFacts = this.owner.mind.meetings.privateSayings(session);
    // A title or phrase the user has already said in this room is not a
    // disclosure by itself. Explicit secrets retain the stricter check above.
    const alreadySaid = snapshot.messages
      .filter((m) => m.role === "user")
      .slice(-12)
      .map((m) => m.text || "");
    const check = (response) => {
      const issues = validateResponse(
        response,
        snapshot,
        turn,
        policy.maxReply,
      );
      if (leaks(response.bubbles, secrets).length)
        issues.push("这句话说出了别人要求保密的事，不能在这里说");
      if (leaks(response.bubbles, privateFacts, alreadySaid).length)
        issues.push("这句话把私下知道的事说出来了，不能在这里说");
      if (bookkeeping(response.bubbles, snapshot))
        issues.push(
          "别用记账、认账、验收、立此存照这类说法，像在办手续；直接说你的反应",
        );
      if (announcesUnseen(response.bubbles, snapshot, c.generationImages))
        issues.push(
          "没看清的图不用宣布，也不数第几张；照着文字和语气接，或者不提图",
        );
      if (
        this.owner.mind.relationships.discloses(
          response.bubbles,
          session,
          this.owner.now(),
        )
      )
        issues.push(
          "这句话说出了私下绑定的关系或备注，不能在这里说；把它放进自己的想法也不会扩大公开范围",
        );
      return issues;
    };
    const recentPrivateContinuity =
      c.direct &&
      !c.privateChat &&
      snapshot.inner?.continuity?.people?.some(
        (person) =>
          person.recentShared?.length || person.myPrivateIntentions?.length,
      );
    // An open question in a group no longer sends every reply to a second
    // model asking whether she answered all of it: that audit made her
    // complete and flat (round 24 real logs). A question put to her, in
    // private, or "what do you mean?" still gets it; facts, promises and care
    // still go to review below.
    const deepCheckFor = (response, ignoreBotTail = false) =>
      (readerQuestions(snapshot, turn).length > 0 &&
        (c.direct || c.privateChat || focus === "readability_repair")) ||
      (turn.contribution?.kind === "question" &&
        snapshot.messages
          .filter((m) => m.role === "assistant")
          .slice(-3)
          .some((m) => /[?？]/.test(m.text || ""))) ||
      currentExchange(snapshot).thirdPartyClaims.length > 0 ||
      response.bubbles.some((line) =>
        /你(?:的|在|给|付|掏).{0,12}(?:账单|费用|钱|token)|(?:烧|花|扣|付).{0,6}你.{0,6}(?:钱|token)|账单.{0,8}你/i.test(
          line,
        ),
      ) ||
      response.bubbles.some((line) =>
        /我.{0,20}(?:只(?:能|有)|才(?:能|有)).{0,15}(?:回|输入|消息|开口)|(?:没人|没有人).{0,12}(?:递话|说话|叫我).{0,12}(?:我.{0,5})?(?:不会|不|才)/.test(
          line,
        ),
      ) ||
      response.bubbles.some((line) =>
        /(?:我|刚才|刚刚|刚还|今天|昨天|之前).{0,25}(?:读过|读了|读完|翻开|在翻|写完|完成了|看完了)/.test(
          line,
        ),
      ) ||
      response.bubbles.some((line) =>
        /食堂|外卖|吃了|吃完|点好|点完|拍照|实拍|出门|上课/.test(line),
      ) ||
      (snapshot.inner?.relationships?.known || []).some(
        (person) =>
          person.name &&
          !snapshot.batch.some(
            (m) => String(m.speaker) === String(person.subjectId),
          ) &&
          response.bubbles.some((line) => line.includes(person.name)),
      ) ||
      response.bubbles.some((line) =>
        /名下|落款|拎着|挂.{0,8}栏|这半|那半|落笔/.test(line),
      ) ||
      response.bubbles.some((line) =>
        /从.{1,16}(?:学来|听来|知道|学的)|(?:教|告诉)我的/.test(line),
      ) ||
      (!ignoreBotTail && conversationGrounding(snapshot).botOnlyTail >= 6) ||
      snapshot.batch.some((m) =>
        /看不懂|没看懂|听不懂|太抽象|人机|复读|说人话|好好说话|冷淡|冷漠|你觉得我|我的人格|性格怎么样/.test(
          m.text || "",
        ),
      ) ||
      response.bubbles.some((line) =>
        /没重看|我.{0,8}(?:重看|重玩|通关|看完了|玩完了)/.test(line),
      ) ||
      (policy.deepCheck &&
        c.pressure < 0.85 &&
        snapshot.batch.some((m) =>
          /想你|喜欢你|爱你|你知道|是谁|谁是|是不是|不太清|不敢说/.test(
            m.text || "",
          ),
        )) ||
      !!snapshot.initiative ||
      !!snapshot.inner?.relationships?.requested ||
      !!snapshot.inner?.continuity?.requested ||
      focus === "clarify_claim" ||
      focus === "basis_check" ||
      !!(
        c.direct &&
        snapshot.inner?.continuity?.people?.some(
          (person) => person.myElsewhereWords?.length,
        )
      ) ||
      !!recentPrivateContinuity ||
      // Reviews guard facts, promises and care, not how much she said: a
      // long or undirected line alone no longer waits for a second model.
      (policy.deepCheck &&
        c.pressure < 0.85 &&
        (turn.crisis?.clear ||
          [
            "feeling",
            "vent",
            "repair",
            "promise_check",
            "clarify_claim",
            "basis_check",
          ].includes(focus)));
    // A bot exchange whose reply the contribution review already found to
    // add something new does not need a second review for that same reason.
    const contributionReviewed =
      trace.contributionReview?.hasContribution === true;
    const needsDeepCheck = (response) => {
      const needed = deepCheckFor(response, contributionReviewed);
      if (!needed && contributionReviewed && deepCheckFor(response))
        trace.steps.push("接话内容已复核过，这次不再为同一原因整段复审");
      return needed;
    };
    const deepCheck = async (response) => {
      // The reply is already written; these checks only decide whether it
      // goes out as it is. A stalled call used to hold a finished reply for
      // minutes (one network timeout plus its retry took 187 s). Past the
      // deadline a check counts as unavailable, the same as a failed one.
      // In a group nobody called her in, a reply that waits half a minute
      // for its review has already missed the moment.
      const deadline =
        Date.now() +
        (policy.deepCheckDeadlineMs ??
          (!c.privateChat ? GROUP_CHECK_DEADLINE_MS : DEEP_CHECK_DEADLINE_MS));
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("复审超过截止时间")),
          Math.max(0, deadline - Date.now()),
        );
        timer.unref?.();
      });
      late.catch(() => {});
      const within = (pending) => Promise.race([pending, late]);
      // The checks below do not depend on one another's answers, only on
      // the order in which their verdicts count. They are asked together and
      // read in that order: a reply that needs two or three reviews waits
      // for the slowest one instead of their sum. A later verdict is simply
      // unused when an earlier one already rejects the draft.
      const ask = (...args) => {
        const pending = models.call(...args);
        pending.catch(() => {});
        return pending;
      };
      try {
        const claims = currentExchange(snapshot).thirdPartyClaims;
        const questions = readerQuestions(snapshot, turn);
        // An old expression can already contain a fictional action. Check
        // the actual words again against activity records, without giving
        // that draft or its own earlier explanations the role of evidence.
        const livedNeeded =
          snapshot.initiative &&
          claimsLivedAction(response.bubbles.join("\n")) &&
          !(
            trace.experienceReview?.ok === true &&
            trace.experienceReview.words.join("\n") ===
              response.bubbles.join("\n")
          );
        const livedCheck =
          livedNeeded &&
          ask(
            model,
            "validation",
            EXPRESSION_GROUNDING,
            {
              candidate: { words: response.bubbles },
              currentLife: snapshot.inner?.currentLife || {},
              notes: [],
              self: [],
            },
            trace,
          );
        // In private a question to her is reviewed at full effort; in a group
        // the moment matters more, and the anti-sycophancy gate is re-run
        // for it (round 24).
        const review = ask(
          c.direct && questions.length && c.privateChat ? model : quickModel,
          "validation",
          replyPrompt(nature, prompt, "validation"),
          {
            context: reviewContext(snapshot, turn, response),
            decision: {
              choice: turn.choice,
              reason: turn.reason,
              targetMessageIds: turn.targetMessageIds,
            },
            response,
            experienceEvidence:
              "自己的旧回复与expression草稿都可能误报经历，不单独证明实际读过、做完或正在做。sourceMaterial里的earlier_thought只证明当时想过。声称具体活动须核对currentLife的真实作品、阅读与动作证据；待办和愿望不能证明执行。自己此刻的想法与感受不需要外部动作证明。普通问候不用补答已经换了话题的旧任务。",
            replyFocus: replyFocus(snapshot, turn),
            thirdPartyClaims: currentExchange(snapshot).thirdPartyClaims,
            imageEvidence: c.generationImages.length
              ? "复审已附上回合模型看到的同一张画面；据图核对具体描述，不凭空判定为编造。"
              : snapshot.vision
                ? "本轮有图片观察结果，回复可以依据 context.vision，不要当成编造。"
                : snapshot.unavailableImages?.length
                  ? "本轮图片没有读取成功，回复不应包含具体画面细节。"
                  : undefined,
            ...(snapshot.initiative
              ? {
                  task: "本轮没有收到新消息，是自己先形成念头再分享。逐项检查：有没有捏造对方刚说过或发过消息；有没有把旧消息当成当前提问而补答；有没有把自己的念头换成另一件事；有没有捏造亲历；有没有把其他会话的参与者、项目、约定误认成当前对象或咱们的事。依据 expression.audience.origin 核对真实来源与参与者。未参与者也可以聊：她认为有分享价值并自然给背景，不应仅因shared:false或话题来自别处而否决。公开可知不代表当前对象参与过、知道上下文或有相同需求。expression.words 也可能误认对象，不可因它是已有草稿而免检；可以改成向当前对象介绍新想法。只有具体错误才给 issues。",
                }
              : {}),
          },
          trace,
          c.generationImages,
        );
        const claimingSpeakers = new Set(
          snapshot.messages
            .filter((m) => claims.some((claim) => claim.id === m.id))
            .map((m) => m.speaker),
        );
        const intentCheck =
          claims.length > 0 &&
          ask(
            model,
            "validation",
            INTENT_CHECK,
            {
              claims,
              humanWords: snapshot.messages
                .filter(
                  (m) => m.role === "user" && !claimingSpeakers.has(m.speaker),
                )
                .slice(-8)
                .map(({ id, speaker, text }) => ({ id, speaker, text })),
              reply: response.bubbles,
            },
            trace,
          );
        // Whether the reply answers the person who asked is a plain reading
        // question. Measured on the review probe, it is as accurate without
        // hidden reasoning and no longer the slowest call of the turn; the
        // main review above keeps the configured effort (without it, an
        // unsupported change of mind slipped through). Only a model that
        // itself offers "none" is asked this way.
        const readerCheck =
          questions.length > 0 &&
          ask(
            model.reasoningEfforts?.includes?.("none")
              ? { ...model, reasoningEffort: "none" }
              : model,
            "validation",
            readerCheckPrompt(turn),
            {
              questions,
              choice: turn.choice,
              reply: response.bubbles,
            },
            trace,
          );
        if (livedCheck) {
          const lived = await within(livedCheck);
          if (lived.ok !== true)
            return [
              `主动消息声称的新行动尚无实际活动记录支持：${lived.reason || "没有核实该行动"}`,
            ];
        }
        const checked = await within(review);
        if (typeof checked.ok !== "boolean" || !Array.isArray(checked.issues)) {
          trace.steps.push("回复复审结果格式异常，已按本地校验继续");
          return snapshot.initiative
            ? ["主动消息的语境核对结果无效，草稿保留"]
            : [];
        }
        if (checked.ok && intentCheck) {
          const intent = await within(intentCheck);
          if (intent.ok === false && Array.isArray(intent.issues))
            return intent.issues.map(
              (issue) => `第三方解释尚未被本人确认：${issue}`,
            );
        }
        if (checked.ok && readerCheck) {
          const reader = await within(readerCheck);
          const verdict = readerVerdict(reader);
          if (verdict.note) trace.steps.push(verdict.note);
          if (verdict.rewrite)
            return reader.issues.map(
              (issue) => `给提问者的解释仍没说清：${issue}`,
            );
        }
        const issues = filterTranscriptContradictedIssues(
          checked.issues,
          snapshot,
        );
        const found =
          checked.ok || (checked.issues.length > 0 && !issues.length)
            ? []
            : issues.length
              ? issues
              : ["与天性或语境不一致"];
        // The reviewer's own minimal repair, used in a group to save a
        // rewrite and a second review (round 24 latency).
        if (
          found.length &&
          Array.isArray(checked.fixed) &&
          checked.fixed.length &&
          checked.fixed.every((line) => typeof line === "string" && line.trim())
        )
          found.fixed = checked.fixed.map((line) => line.trim()).slice(0, 4);
        return found;
      } catch (error) {
        trace.steps.push(
          `回复复审暂不可用，已按本地校验继续：${error.message}`,
        );
        return snapshot.initiative
          ? ["主动消息的事实与内容核对暂未完成，草稿保留，稍后重新决定"]
          : [];
      } finally {
        clearTimeout(timer);
      }
    };
    if (outdated()) return staleExit();
    if (
      !turn.bubbles.length &&
      !turn.sticker &&
      turn.actions?.some((a) => !["reply", "voice"].includes(a.type)) &&
      !turn.crisis?.clear
    ) {
      // Only an action (a poke, a reaction, a die): no words to check.
      trace.response = { bubbles: [], actions: turn.actions };
      trace.sent = [];
      if (c.replay) return finish("replayed", "隔离回放完成，未发送或写入记忆");
      if (c.preview) return finish("previewed", turn.reason);
      const done = await this.doActions(
        batch.at(-1) || c.anchor,
        turn,
        trace,
        session,
      );
      return finish(done.length ? "sent" : "cancelled", turn.reason);
    }
    if (!turn.bubbles.length && turn.sticker && !turn.crisis?.clear) {
      // Only a sticker: nothing to check in words, it was chosen from hers.
      trace.response = { bubbles: [], sticker: turn.sticker.ref };
      trace.sent = [];
      const sent = await this.sendSticker(
        batch.at(-1) || c.anchor,
        turn,
        trace,
        session,
        isCurrent,
      );
      return finish(sent ? "sent" : "cancelled", turn.reason);
    }
    let response = turn.bubbles.length
      ? normalizeResponse(
          { bubbles: turn.bubbles, reason: turn.reason },
          turn,
          fallbackText,
        )
      : await makeResponse();
    response = trimmedSpeech(response, snapshot, c.generationImages, trace);
    let issues = check(response);
    if (!issues.length && needsDeepCheck(response)) {
      if (outdated()) return staleExit();
      issues = await deepCheck(response);
    }
    // One rewrite in a group she was not called in: if that still fails, she
    // simply does not say it (below) instead of a third round of checks.
    const rewriteLimit =
      c.pressure >= 0.85 || (!c.direct && !c.privateChat && !turn.crisis?.clear)
        ? 1
        : 2;
    // In a group, a minimal repair the reviewer already wrote is taken
    // instead of a rewrite and second review, when it passes every local
    // check and only removes or trims what she said.
    if (issues.fixed && !c.privateChat && !turn.crisis?.clear) {
      const original = response.bubbles.join("");
      const repaired = trimmedSpeech(
        { ...response, bubbles: issues.fixed },
        snapshot,
        c.generationImages,
        trace,
      );
      if (
        repaired.bubbles.join("").length <= original.length + 12 &&
        !check(repaired).length
      ) {
        (trace.revisions ||= []).push({
          draft: response.bubbles,
          issues: [...issues],
          repairedByReview: true,
        });
        response = repaired;
        issues = [];
        trace.steps.push("复审给出的最小修改通过本地校验，直接采用");
      }
    }
    const repairConstraints = new Set();
    for (let attempt = 0; issues.length && attempt < rewriteLimit; attempt++) {
      (trace.revisions ||= []).push({
        draft: response.bubbles,
        issues: [...issues],
      });
      trace.validation = issues;
      for (const issue of issues) repairConstraints.add(issue);
      if (outdated()) return staleExit();
      response = await makeResponse(
        [...repairConstraints],
        response,
        !snapshot.initiative && attempt === rewriteLimit - 1,
      );
      response = trimmedSpeech(response, snapshot, c.generationImages, trace);
      issues = check(response);
      if (!issues.length && needsDeepCheck(response)) {
        if (outdated()) return staleExit();
        issues = await deepCheck(response);
      }
    }
    // Deleting an unnecessary final bubble can retain a valid answer. It
    // never bypasses factual, privacy or comprehension checks, and crisis
    // responses keep their complete support rather than being shortened.
    if (issues.length && response.bubbles.length > 1 && !turn.crisis?.clear) {
      for (let count = response.bubbles.length - 1; count > 0; count--) {
        const prefix = {
          ...response,
          bubbles: response.bubbles.slice(0, count),
        };
        const remaining = check(prefix);
        if (remaining.length) continue;
        if (outdated()) return staleExit();
        const reviewed = needsDeepCheck(prefix) ? await deepCheck(prefix) : [];
        if (reviewed.length) continue;
        response = prefix;
        issues = [];
        trace.steps.push(
          "删去未通过检查的多余末尾气泡，保留已通过全部校验的原答复",
        );
        break;
      }
    }
    // Removing a rejected suffix is a mechanical repair with no new factual
    // claims. Preserve the answer, then run every check again.
    if (issues.some((issue) => issue.startsWith("不要把hh反复当句尾装饰"))) {
      const plain = {
        ...response,
        bubbles: response.bubbles.map((line) =>
          line.replace(/[hH]{2,}[。！!～~]*$/, "").trim(),
        ),
      };
      const remaining = check(plain);
      if (!remaining.length) {
        const reviewed = needsDeepCheck(plain) ? await deepCheck(plain) : [];
        if (!reviewed.length) {
          response = plain;
          issues = [];
          trace.steps.push("去掉被退回的hh句尾装饰，原有内容经完整校验后保留");
        }
      }
    }
    if (
      issues.length &&
      ["clarify_claim", "promise_check", "repair", "basis_check"].includes(
        focus,
      ) &&
      contradictoryOwnWords(snapshot, turn)
    ) {
      const honest = {
        bubbles: ["我前面确实说过，后来解释得前后不一致，是我说乱了。"],
        reason: "已发出的原话互相矛盾，先承认自己说乱了",
      };
      const checked = check(honest);
      if (!checked.length) {
        trace.steps.push("本人旧话互相矛盾，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    if (
      issues.length &&
      focus === "clarify_claim" &&
      issues.some((issue) =>
        /第三人的主人|倒置时间|追问者承担误解责任/.test(issue),
      )
    ) {
      const honest = {
        bubbles: [
          "那句‘你主人’是我回他时说错了，我没有依据说他有主人。后来又解释乱了，是我的问题。",
        ],
        reason: "旧话错误且原回复对象明确，承认没有依据",
      };
      if (!check(honest).length) {
        trace.steps.push("旧话将第三人关系说错，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    if (
      issues.length &&
      focus === "basis_check" &&
      issues.some((issue) => /自己先开口的/.test(issue))
    ) {
      const honest = {
        bubbles: [
          "那句是我自己先开口的，你之前没发消息。我只是猜的，没有别的依据。",
        ],
        reason: "自己先开口的话没有他发来的消息可依，承认是猜的",
      };
      if (!check(honest).length) {
        trace.steps.push("先开口的话被追问依据，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    trace.response = response;
    if (issues.length) {
      if (snapshot.initiative) {
        trace.validation = issues;
        return finish("error", "想说的话还没整理好，愿望保留，稍后重新决定");
      }
      trace.validation = issues;
      // Nobody called her here: a filler word says nothing to the room, and
      // often repeats the last one. Not saying it is the plain answer.
      if (!c.direct && !c.privateChat && !turn.crisis?.clear && !c.preview) {
        trace.steps.push(
          "没有人在叫她，回复两次仍未通过校验，不用空话顶替，不说了",
        );
        return finish("silent", "没被叫到，话没整理好，就不说了");
      }
      // Checks protect the words; when someone did call her, they must not
      // erase the decision to answer.
      trace.steps.push("回复两次生成仍未通过校验，使用本地安全短句");
      response = { bubbles: [fallbackText], reason: "本地安全短句" };
      trace.response = response;
    }
    if (c.replay) return finish("replayed", "隔离回放完成，未发送或写入记忆");
    if (c.preview) return finish("previewed", turn.reason);
    // Give a sender who is adding one last line a moment to finish. The
    // queue already aggregates incoming messages; this catches the tail of
    // a model call before its first bubble is committed to the platform.
    if (this.owner.queue.lanes.has(session) && !turn.crisis?.clear)
      await sleep(250);
    if (!isCurrent()) return staleExit();
    response = this.owner.mind.time.reconcile(
      response,
      session,
      this.owner.now(),
      snapshot.inner?.currentLife?.current,
    );
    // A rewritten or generated reply may type an @ as text; it is made real.
    const typed = typedAt(response.bubbles, turn.at || [], snapshot);
    if (typed.bubbles.length)
      response = { ...response, bubbles: typed.bubbles };
    trace.response = response;
    // She chose to say it aloud: one voice message instead of the bubbles.
    // If the voice cannot be made, the words go out as text as usual.
    const voiced =
      turn.actions?.some((a) => a.type === "voice") &&
      speakable(response.bubbles) &&
      (await this.sendVoice(
        batch.at(-1) || c.anchor,
        response.bubbles,
        turn,
        trace,
        session,
      ));
    if (!voiced)
      trace.sent = await deliver(
        this.owner.repo,
        batch.at(-1) || c.anchor,
        response.bubbles,
        trace,
        this.owner.send,
        isCurrent,
        {
          now: this.owner.now,
          // Her own choice to quote comes first; the old buried-message rule
          // stays as the fallback when she did not choose.
          quote:
            turn.actions?.find((a) => a.type === "reply")?.platformId ||
            buriedTarget(batch, turn.targetMessageIds, session),
          at: typed.at,
          prepareBubble: (line) =>
            this.owner.mind.time.reconcile(
              { bubbles: [line] },
              session,
              this.owner.now(),
              snapshot.inner?.currentLife?.current,
            ).bubbles[0],
        },
      );
    if (!trace.sent.length && hasRelevantUpdate()) return staleExit();
    if (trace.sent.length && turn.actions?.length)
      await this.doActions(batch.at(-1) || c.anchor, turn, trace, session);
    if (trace.sent.length && turn.sticker)
      await this.sendSticker(
        batch.at(-1) || c.anchor,
        turn,
        trace,
        session,
        isCurrent,
      );
    if (trace.sent.length && !c.simulatedTurn) {
      if (turn.share?.workId) {
        try {
          this.owner.mind.time.sharing.choose(
            turn.share.workId,
            session,
            turn.share,
            this.owner.now(),
          );
        } catch (error) {
          trace.steps.push("分享选择未执行：" + error.message);
        }
      }
      this.owner.mind.time.tasks.capture(trace, turn, this.owner.now());
      this.owner.mind.time.interaction(
        session,
        turn.targetMessageIds,
        this.owner.now(),
      );
    }
    return finish(trace.sent.length ? "sent" : "cancelled", turn.reason);
  }
  async sendVoice(message, bubbles, turn, trace, session) {
    const owner = this.owner;
    const settings = voiceSettings(owner.repo);
    if (!voiceOffered(settings)) return false;
    if (owner.actions && !owner.actions.allowed(session, "voice")) {
      trace.steps.push("这段时间语音发得够多了，这句打字发");
      return false;
    }
    const text = bubbles.join("，");
    try {
      const audio = await (owner.synthesize || synthesize)(settings, text);
      const result = await owner.send(message, "", {
        record: { base64: audio.toString("base64") },
      });
      const line = `[你发了语音] ${text}`;
      persistReply(
        owner.repo,
        {
          ...message,
          traceId: trace.id,
          replyTargetIds: turn.targetMessageIds || [],
        },
        line,
        result?.message_id,
        owner.now(),
      );
      owner.actions?.record(session, { type: "voice", result: "done" });
      trace.sent = [line];
      trace.steps.push("这句用语音说了");
      return true;
    } catch (error) {
      owner.actions?.record(session, { type: "voice", result: "failed" });
      trace.steps.push(`语音没发成，改成打字：${error.message}`);
      return false;
    }
  }
  // Her non-text actions, after her words; each is written into her own
  // history so she remembers having done it.
  async doActions(message, turn, trace, session) {
    const done = await performActions(
      this.owner,
      message,
      turn.actions,
      trace,
      session,
    );
    for (const action of done) {
      const line = actionLine(action);
      if (!line) continue;
      persistReply(
        this.owner.repo,
        { ...message, traceId: trace.id, replyTargetIds: [] },
        line,
        "",
        this.owner.now(),
      );
      (trace.sent ||= []).push(line);
    }
    return done;
  }
  // Her sticker, after her words. It is recorded as something she sent, and
  // the use is kept to learn how it landed with this person.
  async sendSticker(message, turn, trace, session, isCurrent) {
    const owner = this.owner;
    const image = owner.stickers?.library.image(turn.sticker.id);
    if (!image || !isCurrent()) return false;
    try {
      await new Promise((r) => setTimeout(r, owner.stickerPause ?? 600));
      const result = await owner.send(message, "", {
        image: {
          base64: Buffer.from(image.bytes).toString("base64"),
          sticker: true,
          summary: "[动画表情]",
        },
      });
      const text = `[表情：${turn.sticker.looks}]`;
      persistReply(
        owner.repo,
        {
          ...message,
          traceId: trace.id,
          replyTargetIds: turn.targetMessageIds || [],
        },
        text,
        result?.message_id,
        owner.now(),
      );
      (trace.sent ||= []).push(text);
      if (!message?.simulated) {
        const target = (message && (message.userId ?? message.speaker)) || "";
        owner.stickers.used({
          stickerId: turn.sticker.id,
          session,
          userId: target,
          topic: turn.topic || "",
        });
      }
      trace.steps.push(`发了一张表情：${turn.sticker.looks}`);
      return true;
    } catch (error) {
      trace.steps.push(`表情没有发出去：${error.message}`);
      return false;
    }
  }
}

// In a group, when several other people have spoken since the one message
// she is answering, the reply would read as aimed at the latest line. Point
// at it the way a person would long-press "reply". Only a single target, only
// a real platform id, and never in a private chat, where order is obvious.
export function buriedTarget(batch, targetIds, session) {
  if (!isGroupSession(session)) return "";
  const targets = Array.isArray(targetIds) ? targetIds : [];
  if (targets.length !== 1) return "";
  const at = batch.findIndex((m) => m.id === targets[0]);
  if (at < 0 || !batch[at].platformId) return "";
  const after = batch
    .slice(at + 1)
    .filter((m) => m.userId !== batch[at].userId);
  return after.length >= 3 ? String(batch[at].platformId) : "";
}

// Whether something learned in private, and touched by what is said here,
// is in front of her this turn.
export function holdsPrivate(snapshot) {
  let seen = "";
  try {
    seen = JSON.stringify([snapshot?.memories || [], snapshot?.inner || {}]);
  } catch {
    return false;
  }
  // Only a private thing that what is being said here actually touches.
  return seen.includes(PRIVATELY_KNOWN) && seen.includes("和这里刚说到的「");
}

// Saying "I couldn't read the picture" again and again became a ritual in
// the group (round 24 real logs). When nobody asked about the pictures and
// she has no view of them, the line is noise, not honesty.
export function announcesUnseen(bubbles, snapshot, images = []) {
  if (images?.length || snapshot?.vision) return false;
  const asked = (snapshot?.batch || []).some((m) =>
    /(?:看|读|识别)(?:不|没)(?:到|出|了)|看得到|看见了吗|能看|图呢|什么原因|为什么.{0,6}图/.test(
      String(m.text || "").replace(/\[(?:图片|动画表情|表情|媒体)\]/g, ""),
    ),
  );
  if (asked) return false;
  return (bubbles || []).some((line) =>
    /图.{0,8}(?:没读|读不|看不清|看不到|没看到|打不开|是空|空的|空标签)|(?:没读|读不)出(?:来|内容)|第[二三四五六七八九十\d]+张|[这那几三两]张.{0,4}(?:也|全|都)?(?:是)?空|(?:读|看)(?:不)?出画面|画面.{0,4}(?:读|看)不|没读出|读不出|(?:图|这张|那张|画面).{0,8}(?:看不明白|看不懂|没看懂|看不清|糊)|(?:看不明白|看不懂|没看懂).{0,4}(?:图|这张)|查无此图|看不看懂|图运|空壳|收到个空|图.{0,6}(?:断线|罢工|挂了)|断线.{0,4}图|我这(?:边)?.{0,8}断线|(?:图|管道).{0,6}瘫|看个摘要|照样空白|(?:这份|这张)?也是白的|重新发一?遍文字/.test(
      line,
    ),
  );
}

// Bookkeeping words: settling, accepting and filing things away is never
// how she talks.
const LEDGER_ALWAYS =
  /认账|记账|账目|账本|对账|算账|认了|认下|认领|这条我认|我认[。！!]?$|验收|并案|立此存照|存照|记一笔|按清白记|清白|结案|散庭|先领|领一半|记下了|记上了/;
const LEDGER_ECHO = /账/;
export function bookkeeping(bubbles) {
  // Round 24 replays: even echoing the room's "账" joke kept the ledger
  // tone going, so it is left to them.
  return (bubbles || []).some(
    (line) => LEDGER_ALWAYS.test(line) || LEDGER_ECHO.test(line),
  );
}

// A clause that only announces an unseen picture, or keeps books, is cut
// out mechanically when the rest of the reply still stands: no rewrite, no
// extra model call.
export function trimmedSpeech(response, snapshot, images, trace) {
  const unseen = (line) => announcesUnseen([line], snapshot, images);
  const ledger = (line) => bookkeeping([line], snapshot);
  const secretive = (line) =>
    /(?:在)?别处聊的|私下聊的|不在这(?:儿|里)(?:细)?(?:说|讲|聊)|不方便(?:在这)?(?:说|讲)|不能(?:在这)?(?:说|讲)|不在这(?:儿|里)?摊开|不摊开|留一手|先不展开/.test(
      line,
    );
  const bad = (line) => unseen(line) || ledger(line) || secretive(line);
  // A bubble that opens on stray punctuation, or on the tail of a cut
  // sentence ("发的算我那份）。…"), loses that fragment (round 24 f17).
  const tidy = (line) =>
    line
      .replace(/^[^（(）)]{2,16}[）)]。(?=\S)/u, "")
      .replace(/^[\s，,。；;、]+/u, "");
  if (response?.bubbles?.length) {
    const cleaned = response.bubbles
      .map((line) => (typeof line === "string" ? tidy(line) : line))
      .filter((line) => typeof line !== "string" || /[\p{L}\p{N}]/u.test(line));
    if (
      cleaned.length &&
      cleaned.some((line, i) => line !== response.bubbles[i])
    ) {
      trace?.steps?.push("去掉气泡开头的残句或标点");
      response = { ...response, bubbles: cleaned };
    }
  }
  if (!response?.bubbles?.some(bad)) return response;
  const bubbles = response.bubbles
    .map((line) => {
      if (!bad(line)) return line;
      // Hinting at a secret colours the whole line; the line goes.
      if (secretive(line)) return "";
      const parts = line.split(/(?<=[，,。！!？?；;])|(?<=—)(?!—)/u);
      const kept = parts.filter((part) => !bad(part)).join("");
      return kept
        .replace(/^[\s，,。；;—]+|[\s，,；;—]+$/gu, "")
        .replace(/^(?:不过|但是|但|而且|所以|然后)[，,]?/u, "")
        .replace(/[，,](?:行|好|嗯)$/u, "");
    })
    .filter((line) => line && /[\p{L}\p{N}]/u.test(line));
  if (!bubbles.length || bubbles.some(bad)) return response;
  trace?.steps?.push("删去宣布没看清图、记账或故作保密的半句，其余照原样");
  return { ...response, bubbles };
}
