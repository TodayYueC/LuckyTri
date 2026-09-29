import { localClock } from "../core/conversation-cues.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { withFallback } from "../core/model-manager.js";
import { evidence, hasCredential, text } from "./util.js";
import { isPrivateSession } from "./memory.js";
import { sameRecentTheme } from "./novelty.js";

// Form a thought before choosing an audience. No transcript, unanswered
// question or destination is supplied here: those belong to delivery, not
// to the origin of what she wants to say.
export class OwnVoice {
  constructor(life) {
    this.life = life;
    this.mind = life.mind;
  }
  material(now) {
    const nature = this.mind.nature.current(now);
    const threads = this.mind.self
      .active({ before: now, now, limit: 40 })
      .filter((s) => this.mind.meetings.stays(s, ""))
      .filter((s) =>
        ["interest", "curiosity", "view", "intention"].includes(s.kind),
      )
      // Older summaries sometimes called advice to someone else an intention.
      // Keep the record, but do not treat it as a project she wants to pursue.
      .filter(
        (s) =>
          s.kind !== "intention" ||
          !/^(?:我)?(?:会|愿意|想)?(?:建议|劝|提醒|鼓励)/.test(s.content),
      )
      .slice(0, 12);
    const notes = this.mind.thoughts
      .open({ now, limit: 40 })
      .filter((t) =>
        this.mind.meetings.stays(
          {
            ...t,
            session_id:
              t.kind === "expression" && !t.sources.length
                ? ""
                : t.sessions.find(isPrivateSession) || "",
          },
          "",
        ),
      )
      .sort((a, b) => b.created - a.created)
      .slice(0, 6);
    const recent = this.mind.thoughts
      .list({ before: now + 1, limit: 80 })
      .filter((t) => t.kind === "expression")
      .slice(0, 12);
    const { mood, energyLabel, phaseLabel } = this.mind.affect.state(now, {
      nature,
    });
    return {
      clock: localClock(now, this.mind.timeZone()),
      mood: { feeling: mood, energy: energyLabel, phase: phaseLabel },
      interests: nature.interests || [],
      self: threads.map((s) => ({
        ref: `s:${s.thread}`,
        kind: s.kind,
        content: s.content,
        emerging: s.status === "emerging",
      })),
      notes: notes.map((t) => ({
        ref: `t:${t.id}`,
        created: t.created,
        kind: t.kind,
        content: t.content,
      })),
      recentExpressions: recent.map((t) => ({
        ref: `t:${t.id}`,
        created: t.created,
        content: t.content,
        said: t.outreach_status === "sent" ? t.outreach : "",
        where: t.outreach_status === "sent" ? t.outreach_session : "",
      })),
    };
  }
  async form(now = this.life.now()) {
    const life = this.life;
    const nature = this.mind.nature.current(now);
    const input = this.material(now);
    const id = life.run("expression", "先听听自己想说什么");
    const trace = life.repo.trace("__mind__", "expression");
    let status = "empty";
    let reason = "此刻没有想表达的新内容";
    let note = null;
    try {
      const profile = life.profile();
      const models = withFallback(
        life.chat.models,
        life.chat.fallbackFor(null, profile, trace),
      );
      const result = await models.call(
        profile,
        "expression",
        replyPrompt(nature, prompts(life.repo), "expression"),
        input,
        trace,
      );
      if (life.closed || this.mind.nature.version() !== nature.version) {
        status = "cancelled";
        reason = "状态已变化，这次想法未保存";
      } else if (result?.note && result.skip !== true) {
        const content = text(result.note, 600);
        const words = (Array.isArray(result.words) ? result.words : [])
          .filter((s) => typeof s === "string" && s.trim())
          .slice(0, 3)
          .map((s) => text(s, 180));
        const sources = evidence(result.sources);
        const valid = new Set(
          [...input.self, ...input.notes].map((s) => s.ref),
        );
        if (
          !content ||
          hasCredential([content, ...words].join("\n")) ||
          sources.some((s) => !valid.has(s))
        )
          throw Error("自己的念头含有无效来源或敏感内容，未保存");
        const repeated = input.recentExpressions.some((t) =>
          sameRecentTheme(t.content, content),
        );
        const surfaceEcho = input.recentExpressions.some(
          (t) => t.said && sameRecentTheme(t.said, words.join("\n")),
        );
        const recentlySaid = input.recentExpressions.filter(
          (t) => t.said && now - t.created < 12 * 3600000,
        );
        const linked = recentlySaid.some((t) => sources.includes(t.ref));
        let echoed = surfaceEcho;
        if (
          !repeated &&
          !echoed &&
          result.share === true &&
          recentlySaid.length
        ) {
          try {
            const verdict = await models.call(
              profile,
              "expression_novelty",
              '比较一个人先前已分享的念头和现在想说的话。只判断核心话题与动机是否仍是同一件事；换词、补一个没有外部新经历的小步骤、换一个群分享，都算同一主题。真正换了关注对象或出现新的经历，才算新内容。不判断好坏。只输出 JSON：{"sameTheme":true或false,"reason":"一句依据"}。',
              {
                candidate: { note: content, words, sources },
                recentlySaid: recentlySaid.slice(0, 6),
              },
              trace,
            );
            echoed =
              verdict?.sameTheme === true ||
              (linked && verdict?.sameTheme !== false);
          } catch {
            // If the related thought cannot be checked, keep its new turn of
            // thought in her journal instead of broadcasting it again.
            echoed = linked;
          }
        }
        if (repeated) reason = "这个念头已经留过，不重复制造新的愿望";
        else {
          const noteId = this.mind.thoughts.add({
            kind: "expression",
            content,
            sources,
            importance: 0.5,
            runId: id,
            time: now,
          });
          note = {
            id: noteId,
            // An idea may grow privately after it has been spoken. Without a
            // new encounter, its next paraphrase should not tour other rooms.
            share: result.share === true && words.length > 0 && !echoed,
            words,
            reason: text(result.reason, 300) || "想把这个念头说出来",
            audience: ["private", "group"].includes(result.audience)
              ? result.audience
              : "either",
          };
          status = "written";
          reason = echoed
            ? "同一念头还在往前长，先留给自己，不换个地方重说"
            : note.share
              ? "留下一个自己想分享的念头"
              : "这句话先留给自己";
        }
      }
    } catch (error) {
      status = "error";
      reason = String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      life.end(id, status, reason, trace, {
        freshMessages: 0,
        ...(note ? { thought: note.id } : {}),
      });
      life.repo.finish(trace, status);
    }
    return { status, reason, note };
  }
}
