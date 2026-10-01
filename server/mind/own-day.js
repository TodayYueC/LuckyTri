import { withFallback } from "../core/model-manager.js";
import { prompts, replyPrompt } from "../core/persona-manager.js";
import { localClock } from "../core/conversation-cues.js";
import { evidence, text, hasCredential } from "./util.js";
import { CommitmentReview } from "./time/commitment-review.js";

export class OwnDay {
  constructor(life) {
    this.life = life;
    this.db = life.db;
    this.review = new CommitmentReview(life);
  }
  state() {
    return this.life.repo.config("own-day", {});
  }
  save(patch) {
    this.life.repo.saveConfig("own-day", { ...this.state(), ...patch });
  }
  request() {
    this.save({ reviewRequested: true });
    return { queued: true };
  }
  async run(now = this.life.now()) {
    const life = this.life,
      time = life.mind.time;
    if (
      this.disabledForTest ||
      life.closed ||
      life.busy ||
      !life.settings().solitude ||
      life.repo.store.settings().demo ||
      life.phase(now).key === "asleep" ||
      time.primary() ||
      !life.mind.budget.allows("inner", now)
    )
      return null;
    let profile;
    try {
      profile = life.profile();
    } catch {
      return null;
    }
    const state = this.state(),
      settings = time.settings(),
      reviewDue =
        state.reviewRequested ||
        now - (state.reviewAt || 0) >= settings.commitmentReviewMinutes * 60000;
    const ownOpen = this.db
      .prepare(
        "SELECT count(*) n FROM mind_time_tasks WHERE kind='plan' AND state IN ('todo','scheduled','doing','paused') AND json_extract(checkpoint,'$.mergedInto') IS NULL",
      )
      .get().n;
    const planDue =
      ownOpen < 3 &&
      now - (state.planAt || 0) >= settings.ownPlanMinutes * 60000;
    if (!reviewDue && !planDue) return null;
    return time.attention.activity(async () => {
      let batch = null;
      if (reviewDue) {
        for (let page = 0; page < 5; page++) {
          batch = this.review.batch(now);
          if (!batch || batch.rows.length) break;
          this.save({ reviewSeq: batch.through });
        }
        if (!batch || !batch.rows.length) {
          this.save({ reviewAt: now, reviewRequested: false });
          batch = null;
        }
      }
      if (!batch && !planDue) return null;
      const reviewing = !!batch,
        trace = life.repo.trace("__mind__", "activity"),
        version = life.mind.nature.version(),
        runId = life.run(
          "day-care",
          reviewing ? "独处回看有没有漏下约定" : "想想接下来愿意做点什么",
        );
      this.save(
        reviewing ? { reviewAt: now, reviewRequested: false } : { planAt: now },
      );
      let status = "error",
        reason = "";
      try {
        const projects = time.works
          .projects({ limit: 12 })
          .filter((p) => p.state === "active" && time.visible(p, "", now))
          .slice(0, 4);
        const self = life.selfView(now, { open: true }).slice(0, 8);
        const input = reviewing
          ? {
              review: batch.messages,
              existing: time.tasks
                .list({ limit: 80 })
                .filter((t) => time.visible(t, batch.session, now))
                .map((t) => ({
                  id: t.id,
                  title: t.title,
                  state: t.state,
                  share: t.share_state,
                }))
                .slice(0, 12),
            }
          : {
              clock: localClock(now, life.mind.timeZone()),
              self,
              interests: life.mind.nature.current(now).interests,
              affect: life.mind.affect.state(now),
              projects: projects.map((p) => ({
                id: p.id,
                title: p.title,
                kind: p.kind,
                summary: text(p.summary, 240),
              })),
              available: {
                read: life.mind.reading.unreadCount() > 0,
                write: true,
                think: true,
                game: !time.search.ready(now),
              },
              pending: time.tasks
                .list({ limit: 20 })
                .filter(
                  (t) =>
                    time.visible(t, "", now) &&
                    !["done", "abandoned"].includes(t.state),
                )
                .map((t) => ({ title: t.title, state: t.state }))
                .slice(0, 5),
            };
        const instruction = reviewing
          ? '独处回看自己确实送达的话有没有漏下承诺。review.said是自己说的话，earlier是前面的真实语境。只提取明确接受的未来行动；玩笑、引用、别人的计划、作品情节、愿望和过去完成的事不算承诺。没有日期也可以有约定。已放下或已完成的事项不要复活，已经整理的事项不要重建。输出JSON {"commitments":[{"source":"m:消息seq","quote":"said中的原文片段","accepted":true,"kind":"promise|plan","activity":"write|read|think|game|unknown","title":"具体行动"}]}，没有遗漏则空数组。只整理，不发送、不声称兑现。'
          : '这是留给自己的空隙，不需要有人先约你，也不需要新消息才有生活。根据自己的兴趣、好奇、已有作品与精力，决定想不想随手做一件有意思的小事。可以阅读、写个小场景、玩一段游戏、整理一个想法，也可以选择歇着。一次最多一件，不为填满时间而列清单，不把别人的建议冒充自己的愿望，不编造外部经历或无法执行的动作。输出JSON {"skip":false,"plan":{"activity":"write|read|think|game","title":"具体小行动，游戏写清名称","why":"自己的动机","sources":["s:本次self中thread"],"projectId":"本次项目ID或null"}}。没有想做的事就skip:true。';
        const answer = await withFallback(
          life.chat.models,
          life.chat.fallbackFor(null, profile, trace),
        ).call(
          profile,
          "reflection",
          replyPrompt(
            life.mind.nature.current(now),
            { ...prompts(life.repo), activity: instruction },
            "activity",
          ),
          input,
          trace,
        );
        if (
          life.closed ||
          version !== life.mind.nature.version() ||
          time.primary()
        ) {
          status = "cancelled";
          return { status };
        }
        if (reviewing) {
          this.db.exec("SAVEPOINT commitment_care");
          try {
            const ids = this.review.apply(batch, answer, life.now());
            this.save({ reviewSeq: batch.through });
            status = "reviewed";
            reason = ids.length
              ? "把说过的约定重新理清了"
              : "回看过这一段，没有漏下的新约定";
            return { status, reason, tasks: ids };
          } catch (error) {
            this.db.exec("ROLLBACK TO commitment_care");
            throw error;
          } finally {
            this.db.exec("RELEASE commitment_care");
          }
        }
        if (answer?.skip === true) {
          status = "resting";
          reason = "这会儿想留一点空白";
          return { status, reason };
        }
        const plan = answer?.plan;
        if (
          !plan ||
          !["read", "write", "think", "game"].includes(plan.activity) ||
          !text(plan.title, 160) ||
          !text(plan.why, 200) ||
          hasCredential(plan.title + plan.why)
        )
          throw Error("自己的安排格式无效");
        if (
          (plan.activity === "read" && !input.available.read) ||
          (plan.activity === "game" && !input.available.game)
        ) {
          status = "waiting";
          reason = "想做的事情还缺少条件";
          return { status, reason };
        }
        const valid = new Set(self.map((s) => `s:${s.thread}`)),
          sources = evidence(plan.sources).filter((s) => valid.has(s)),
          project = projects.find(
            (p) => p.id === plan.projectId && p.kind === plan.activity,
          );
        this.db.exec("SAVEPOINT own_choice");
        try {
          const wish = life.mind.self.propose(
            {
              kind: "intention",
              content: `我想${text(plan.title, 100)}`,
              sources,
              strength: 0.25,
            },
            { valid, origin: "solitude", time: life.now() },
          );
          if (!wish.thread) throw Error(wish.rejected || "愿望未保存");
          const result = time.tasks.add(
            {
              kind: "plan",
              activity: plan.activity,
              title: plan.title,
              why: plan.why,
              sources: [`s:${wish.thread}`, ...(project?.sources || [])],
              projectId: project?.id || null,
              origin: "own-day",
            },
            life.now(),
          );
          const id = result.id || result.duplicate;
          if (result.id)
            time.event(
              id,
              "own-choice",
              "空下来时自己想做的事",
              { wish: wish.thread },
              life.now(),
            );
          status = id ? "planned" : "empty";
          reason = id ? "给自己留下一件想做的事" : "这件事已经有所安排";
          return { status, reason, task: id };
        } catch (error) {
          this.db.exec("ROLLBACK TO own_choice");
          throw error;
        } finally {
          this.db.exec("RELEASE own_choice");
        }
      } catch (error) {
        reason = text(error.message, 160);
        trace.error = reason;
        return { status: "error", reason };
      } finally {
        life.chat.finishQuietly(
          trace,
          status === "error" ? "error" : "complete",
        );
        life.end(runId, status, reason, trace);
      }
    });
  }
}
