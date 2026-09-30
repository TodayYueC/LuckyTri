import { replyFocus } from "./conversation-cues.js";
import { replyPrompt } from "./persona-manager.js";
import { generate } from "./response-generator.js";
import {
  contradictoryOwnWords,
  normalizeResponse,
  reviewContext,
  validateResponse,
} from "./response-validator.js";
import { deliver, sleep } from "./message-scheduler.js";
import { leaks } from "../mind/guard.js";
function isFormatError(error) {
  return (
    error instanceof SyntaxError ||
    /JSON|Unexpected token|格式|气泡|bubbles|choice|输出被截断/i.test(
      error?.message || "",
    )
  );
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
          (m.replyId && snapshot.batch.some((b) => b.platformId === m.replyId)),
      );
    const isCurrent = () =>
      !this.owner.queue.closed &&
      (c.preview ||
        this.owner.enabled(session, { simulated: c.simulatedTurn })) &&
      this.owner.sessionState(session) === c.state &&
      !hasRelevantUpdate();
    const staleExit = () => {
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
      ...(focus === "promise_check"
        ? ["你问的约定我得认真核对，刚才我没接住。", "我先认真核对一下。"]
        : []),
      "嗯",
      "好",
      "行",
      "收到",
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
          ) || "嗯";
    const generationPrompt = replyPrompt(
      nature,
      prompt,
      snapshot.initiative ? "initiative" : "generation",
    );
    const makeResponse = async (issues = []) => {
      try {
        const raw = await generate(
          models,
          model,
          generationPrompt,
          snapshot,
          turn,
          trace,
          c.generationImages,
          issues,
        );
        return normalizeResponse(raw, turn, fallbackText);
      } catch (error) {
        if (!isFormatError(error)) throw error;
        if (snapshot.initiative) throw error;
        trace.steps.push("模型回复格式异常，已使用本地短句兜底");
        return { bubbles: [fallbackText], reason: "本地短句兜底" };
      }
    };
    const secrets = this.owner.mind.memory.secretsOutside(session);
    const privateFacts = this.owner.mind.meetings.privateSayings(session);
    const check = (response) => {
      const issues = validateResponse(
        response,
        snapshot,
        turn,
        policy.maxReply,
      );
      if (leaks(response.bubbles, secrets).length)
        issues.push("这句话说出了别人要求保密的事，不能在这里说");
      if (leaks(response.bubbles, privateFacts).length)
        issues.push("这句话把私下知道的事说出来了，不能在这里说");
      return issues;
    };
    const recentPrivateContinuity =
      c.direct &&
      !c.privateChat &&
      snapshot.inner?.continuity?.people?.some(
        (person) =>
          person.recentShared?.length || person.myPrivateIntentions?.length,
      );
    const needsDeepCheck = (response) =>
      !!snapshot.initiative ||
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
          ].includes(focus) ||
          (!c.direct &&
            (response.bubbles.join("").length > 60 ||
              snapshot.batch.some((m) => m.relation === "unresolved")))));
    const deepCheck = async (response) => {
      try {
        const checked = await models.call(
          model,
          "validation",
          replyPrompt(nature, prompt, "validation"),
          {
            context: reviewContext(snapshot, turn),
            decision: {
              choice: turn.choice,
              reason: turn.reason,
              targetMessageIds: turn.targetMessageIds,
            },
            response,
            replyFocus: replyFocus(snapshot, turn),
            imageEvidence: c.generationImages.length
              ? "复审已附上回合模型看到的同一张画面；据图核对具体描述，不凭空判定为编造。"
              : snapshot.vision
                ? "本轮有图片观察结果，回复可以依据 context.vision，不要当成编造。"
                : snapshot.unavailableImages?.length
                  ? "本轮图片没有读取成功，回复不应包含具体画面细节。"
                  : undefined,
            ...(snapshot.initiative
              ? {
                  task: "本轮没有收到新消息，是自己先形成念头再分享。逐项检查：有没有捏造对方刚说过或发过消息；有没有把旧消息当成当前提问而补答；有没有把自己的念头换成另一件事；有没有捏造亲历。expression.words 是已有草稿，保留其核心是合格的，不要求提供新事实。只有具体错误才给 issues。",
                }
              : {}),
          },
          trace,
          c.generationImages,
        );
        if (typeof checked.ok !== "boolean" || !Array.isArray(checked.issues)) {
          trace.steps.push("回复复审结果格式异常，已按本地校验继续");
          return snapshot.initiative
            ? ["主动消息的语境核对结果无效，草稿保留"]
            : [];
        }
        return checked.ok
          ? []
          : checked.issues.length
            ? checked.issues
            : ["与天性或语境不一致"];
      } catch (error) {
        trace.steps.push(
          `回复复审暂不可用，已按本地校验继续：${error.message}`,
        );
        return snapshot.initiative
          ? ["主动消息的事实与内容核对暂未完成，草稿保留，稍后重新决定"]
          : [];
      }
    };
    if (outdated()) return staleExit();
    let response = turn.bubbles.length
      ? normalizeResponse(
          { bubbles: turn.bubbles, reason: turn.reason },
          turn,
          fallbackText,
        )
      : await makeResponse();
    let issues = check(response);
    if (!issues.length && needsDeepCheck(response)) {
      if (outdated()) return staleExit();
      issues = await deepCheck(response);
    }
    const rewriteLimit = snapshot.inner?.continuity?.people?.some(
      (person) => person.myElsewhereWords?.length,
    )
      ? 2
      : 1;
    for (let attempt = 0; issues.length && attempt < rewriteLimit; attempt++) {
      trace.validation = issues;
      if (outdated()) return staleExit();
      response = await makeResponse(issues);
      issues = check(response);
      if (!issues.length && needsDeepCheck(response)) {
        if (outdated()) return staleExit();
        issues = await deepCheck(response);
      }
    }
    if (issues.length && contradictoryOwnWords(snapshot, turn)) {
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
      if (
        !c.direct &&
        !c.privateChat &&
        !turn.crisis?.clear &&
        !c.replay &&
        !c.preview
      ) {
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
    trace.response = response;
    trace.sent = await deliver(
      this.owner.repo,
      batch.at(-1) || c.anchor,
      response.bubbles,
      trace,
      this.owner.send,
      isCurrent,
      {
        now: this.owner.now,
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
}
