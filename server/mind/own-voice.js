import { localClock } from "../core/conversation-cues.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { withFallback } from "../core/model-manager.js";
import { HOUR, evidence, hasCredential, text } from "./util.js";
import { isPrivateSession } from "./memory.js";
import { sameRecentTheme } from "./novelty.js";
import { ownLife, sameSelf } from "./salience.js";
import { conversationOrigin, originSummary } from "./conversation-origin.js";

// After this many notes in a row that only take up her own last note, another
// one has to pick up something new or it is not kept.
const STREAK = 3;

// Form a thought before choosing an audience. No transcript, unanswered
// question or destination is supplied here: those belong to delivery, not
// to the origin of what she wants to say.
export class OwnVoice {
  constructor(life) {
    this.life = life;
    this.mind = life.mind;
  }
  // What has come into her life since `after` that this loop did not write
  // itself: thoughts from solitude, night memory or a review, and threads
  // those revised. Her own expression write-backs are not new.
  arrived(after, until) {
    const thoughts = this.mind.db
      .prepare(
        "SELECT id FROM mind_thoughts WHERE created>? AND created<=? AND kind!='expression' AND hidden=0",
      )
      .all(after, until)
      .map((row) => `t:${row.id}`);
    const threads = this.mind.db
      .prepare(
        "SELECT DISTINCT thread FROM mind_self WHERE created>? AND created<=? AND origin!='expression'",
      )
      .all(after, until)
      .map((row) => `s:${row.thread}`);
    return new Set([...thoughts, ...threads]);
  }
  // How many of her newest notes only took up the one before. A note is
  // anchored when it cites something that arrived after the previous note.
  circling(now) {
    const notes = this.mind.thoughts
      .list({ before: now + 1, limit: 40, hidden: false })
      .filter((t) => t.kind === "expression");
    let run = 0;
    for (let i = 0; i + 1 < notes.length; i++) {
      const note = notes[i];
      const previous = notes[i + 1];
      if (note.created - previous.created > 24 * HOUR) break;
      const arrived = this.arrived(previous.created, note.created);
      if (note.sources.some((ref) => arrived.has(ref))) break;
      run++;
    }
    return { run, latest: notes[0] || null };
  }
  // Going round again with nothing new is not a reason to ask her: she has
  // written several notes that only continue her last one, and nothing she
  // could take up has come in since.
  resting(now) {
    const { run } = this.circling(now);
    if (run < STREAK) return null;
    const { circling } = this.material(now);
    if (circling?.fresh.length) return null;
    return `连着 ${run} 条念头都只在接自己上一条，还没有新的东西可接`;
  }
  material(now) {
    const nature = this.mind.nature.current(now);
    const threads = this.mind.self
      .active({ before: now, now, limit: 40 })
      .filter((s) => this.mind.meetings.stays(s, ""))
      .filter((s) =>
        ["interest", "curiosity", "view", "intention"].includes(s.kind),
      )
      // Older summaries sometimes called advice or a duty to someone else
      // an intention. Keep the record, but do not treat it as a life she
      // is living.
      .filter((s) => s.kind !== "intention" || ownLife(s.content))
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
    // Only what she can see counts as something she could take up. A note
    // she was shown and did not take up is not offered again until more
    // arrives.
    const { run, latest } = this.circling(now);
    const since = Math.max(
      latest?.created ?? 0,
      this.life.repo.config("own-voice", {}).circledAt ?? 0,
    );
    const arrived = run >= 2 ? this.arrived(since, now) : new Set();
    const fresh = [
      ...threads.map((s) => `s:${s.thread}`),
      ...notes.map((t) => `t:${t.id}`),
    ].filter((ref) => arrived.has(ref));
    return {
      ...(run >= 2 ? { circling: { notes: run, fresh } } : {}),
      clock: localClock(now, this.mind.timeZone()),
      currentLife: this.mind.time.view({ session: "", now }),
      actions: this.mind.time.lived({
        session: "",
        before: now,
        since: now - 86400000,
      }),
      mood: { feeling: mood, energy: energyLabel, phase: phaseLabel },
      interests: nature.interests || [],
      self: threads.map((s) => ({
        ref: `s:${s.thread}`,
        kind: s.kind,
        content: s.content,
        emerging: s.status === "emerging",
        origin: originSummary(conversationOrigin(this.mind.db, s.sources, now)),
      })),
      notes: notes.map((t) => ({
        ref: `t:${t.id}`,
        created: t.created,
        kind: t.kind,
        content: t.content,
        origin: originSummary(
          conversationOrigin(this.mind.db, [`t:${t.id}`], t.created),
        ),
      })),
      ...(() => {
        const world = this.mind.observations.recent({
          since: now - 86400000,
          before: now,
          limit: 4,
        });
        return world.length ? { world } : {};
      })(),
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
          [
            ...input.self,
            ...input.notes,
            ...input.actions,
            ...(input.world || []),
          ].map((s) => s.ref),
        );
        if (
          !content ||
          hasCredential([content, ...words].join("\n")) ||
          sources.some((s) => !valid.has(s))
        )
          throw Error("自己的念头含有无效来源或敏感内容，未保存");
        // Several notes in a row already went round without taking anything
        // new up. Another one that still does not is not kept.
        const drifting =
          (input.circling?.notes ?? 0) >= STREAK &&
          !sources.some((ref) => input.circling.fresh.includes(ref));
        const repeated =
          drifting ||
          input.recentExpressions.some((t) =>
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
        if (drifting) {
          life.repo.saveConfig("own-voice", {
            ...life.repo.config("own-voice", {}),
            circledAt: now,
          });
          reason =
            "连着几条念头都只在接自己上一条，这一条也没接住新的东西，不留";
        } else if (repeated) reason = "这个念头已经留过，不重复制造新的愿望";
        else {
          const noteId = this.mind.thoughts.add({
            kind: "expression",
            content,
            sources,
            importance: 0.5,
            runId: id,
            time: now,
          });
          // A new wording of a wish she already holds writes back to that
          // thread. It does not invent a second livingFor.
          const match = this.mind.self
            .latest(now)
            .find(
              (row) =>
                row.status !== "closed" &&
                !/^(?:我)?(?:会|愿意|想)?(?:建议|劝|提醒|鼓励)/.test(content) &&
                sameSelf(row.content, content),
            );
          if (match)
            this.mind.self.propose(
              {
                thread: match.thread,
                content: text(content, 80),
                sources: [`t:${noteId}`],
              },
              { origin: "expression", time: now },
            );
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
