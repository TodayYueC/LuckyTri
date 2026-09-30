import { parseSessionKey } from "../channels/session-key.js";
import { initiativeContext, initiativeSnapshot } from "./initiative-context.js";
import { withFallback } from "./model-manager.js";
import { replyPrompt, prompts } from "./persona-manager.js";
import { buildContext, perceive } from "./context-builder.js";
import {
  loadVisionImages,
  visionInputs,
  classifyVision,
  classifyLoaded,
  descriptionsFor,
  mergeVision,
  saveVision,
  markVisionSeen,
  visionWindow,
} from "./vision-manager.js";
import { normalizeTurn, takeTurn } from "./turn.js";
const OCCASIONS = {
  wake: "你刚睡醒，看到了睡着时收到的消息。它们是之前发的，按消息时间理解，可以自然地说刚看到。",
  backlog:
    "这些是你刚才没细看的消息，现在回头看了一眼，已经隔了一会儿，不必每条都回。",
  outreach:
    "这是你自己先前想说的一句（occasion.thought），可能来自你正在为自己而活的事。现在仍然合适就说这一句，不合适就 silent。occasion.returned 是你写下这句话之后又见到的人；人已经出现了，就按现在的情况决定，不要假装还没见过。不要改口说没人找你，不要把留下对方当成对方的责任，不要把「我只是助手」当成收尾。",
  presence:
    "你自己在这里待了一会儿。不是等待一个必须回答的问题；看看自己的兴趣、念头、心情和对人的感觉，此刻想不想说点什么，由你选择。",
};
function isPrivateSession(session) {
  if (String(session).startsWith("preview:")) return true;
  try {
    return parseSessionKey(session).kind === "private";
  } catch {
    return String(session).startsWith("private");
  }
}
function isFormatError(error) {
  return (
    error instanceof SyntaxError ||
    /JSON|Unexpected token|格式|气泡|bubbles|choice|输出被截断/i.test(
      error?.message || "",
    )
  );
}

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class TurnProcessor {
  constructor(owner) {
    this.owner = owner;
  }
  async process(
    session,
    batch,
    {
      replay = false,
      simulated = false,
      preview = null,
      occasion: planned = null,
      backlog = false,
      anchor = null,
    } = {},
  ) {
    let occasion = planned;
    const ownInitiative =
      !batch.length && ["presence", "outreach"].includes(planned?.type);
    const simulatedTurn =
      !replay && (simulated || !!preview || batch.some((m) => m.simulated));
    const live = !replay && !simulatedTurn;
    const clock = () =>
      replay || simulatedTurn
        ? (batch.at(-1)?.time ?? this.owner.now())
        : this.owner.now();
    const nature = preview?.nature
      ? { ...this.owner.mind.nature.current(), ...preview.nature }
      : this.owner.mind.traits.effective(
          this.owner.mind.nature.current(clock()),
          clock(),
        );
    let watermark = batch.at(-1)?.seq ?? this.owner.repo.latest(session);
    const eventMode = simulatedTurn;
    let resolved = null;
    let gate = null;
    if (live && !occasion) {
      if (!this.owner.enabled(session, { simulated: false })) {
        // She is not in this conversation; what passes here is not unread.
        this.owner.mind.look(session, watermark, this.owner.now());
      } else {
        resolved = perceive(
          this.owner.repo,
          session,
          watermark,
          eventMode,
          nature.name,
        );
        gate = this.owner.gate(session, batch, resolved, clock(), nature);
        if (!gate.look && backlog)
          return { status: "glanced", reason: gate.reason };
        if (backlog) occasion = { type: "backlog" };
      }
    }
    const trace = this.owner.repo.trace(
      session,
      replay ? "replay" : preview ? "preview" : simulatedTurn ? "demo" : "live",
    );
    const policy = this.owner.policy(preview?.viewSession || session);
    const state = this.owner.sessionState(session);
    const clearEpoch = this.owner.clearEpoch.get(session) || 0;
    const privateChat = isPrivateSession(session);
    if (!replay && !preview)
      for (const m of batch)
        this.owner.repo.db
          .prepare(
            "UPDATE core_jobs SET status='running',trace_id=? WHERE seq=?",
          )
          .run(trace.id, m.seq);
    const finish = (status, reason) => {
      trace.reason = reason;
      if (!replay && !preview)
        for (const m of batch)
          this.owner.repo.db
            .prepare("UPDATE core_jobs SET status=? WHERE seq=?")
            .run(status, m.seq);
      this.owner.repo.finish(trace, status);
      if (
        !replay &&
        !preview &&
        this.owner.repo.db
          .prepare("SELECT id FROM sessions WHERE id=?")
          .get(session)
      )
        this.owner.store.log(
          session,
          "语境决策",
          reason,
          trace.sent?.join("\n") || "",
          Number(!!simulatedTurn),
        );
      return trace;
    };
    try {
      if (
        !replay &&
        !preview &&
        !this.owner.enabled(session, { simulated: simulatedTurn })
      ) {
        this.owner.mind.unlived(batch.map((m) => m.seq));
        return finish("silent", "会话已暂停或处于模拟模式");
      }
      if (gate) {
        trace.attention = {
          look: gate.look,
          score: gate.score,
          threshold: gate.threshold,
          reason: gate.reason,
        };
        if (!gate.look) {
          if (gate.defer) this.owner.mind.defer(session);
          // A glance still counts as seeing who is around; a closer look
          // records it after the turn, once she has noticed any absence.
          else
            this.owner.mind.bonds.meet(
              batch
                .filter((m) => m.role === "user")
                .map((m) => ({ userId: String(m.userId), name: m.name })),
              session,
              this.owner.now(),
            );
          return finish(gate.defer ? "deferred" : "glanced", gate.reason);
        }
        batch = gate.rows.length ? gate.rows : batch;
        watermark = Math.max(watermark, batch.at(-1).seq);
      }
      if (!replay && !preview)
        await this.owner.restoreQuotes(session, batch, trace);
      const prompt = prompts(this.owner.repo);
      const now = clock();
      const hasKey =
        this.owner.store.settings().apiKey || process.env.LLM_API_KEY;
      let model;
      try {
        model = this.owner.models.profile();
      } catch (error) {
        // A fresh installation has no model yet; the offline sample keeps the
        // simulator usable. A live turn surfaces the configuration error.
        if (
          preview ||
          (simulatedTurn && this.owner.store.settings().demo && !hasKey)
        )
          return this.owner.offline(session, batch, trace, finish, [], preview);
        throw error;
      }
      const models = withFallback(
        this.owner.models,
        this.owner.fallbackFor(policy, model, trace),
      );
      resolved ||= perceive(
        this.owner.repo,
        session,
        watermark,
        eventMode,
        nature.name,
      );
      const batchIds = batch.map((m) => m.seq);
      const window = resolved.filter((m) => !m.referenceOnly).slice(-60);
      // The speakers in this batch are the people whose history matters now.
      // Pulling everyone from a long room window made unrelated plans compete
      // with the exchange actually taking place.
      const people = [
        ...new Set(
          batch.filter((m) => m.role === "user").map((m) => String(m.userId)),
        ),
      ];
      if (ownInitiative && privateChat && !people.length) {
        try {
          people.push(String(parseSessionKey(session).nativeId));
        } catch {
          /* An unparseable destination has no person to infer. */
        }
      }
      // Replays exclude mutable memory so later corrections cannot leak into
      // the past; her inner state is folded as of the replayed moment.
      const memories =
        policy.memory && !replay && !ownInitiative
          ? this.owner.mind.memory.retrieve(session, batch, now, {
              people,
              touch: live,
              forSpeech: true,
            })
          : [];
      const knowledge = ownInitiative
        ? []
        : replay
          ? this.owner.knowledge.retrieve(session, batch, now)
          : await this.owner.knowledge.retrieveWithEmbed(session, batch, now);
      const summaryView =
        !ownInitiative && !simulatedTurn && policy.compaction !== false
          ? this.owner.compactor.forPrompt(session, {
              before: replay ? batch[0].seq : Number.MAX_SAFE_INTEGER,
              timeZone: policy.timeZone,
            })
          : { summaries: [], coverage: 0, start: 0 };
      const stages =
        policy.memory && !ownInitiative
          ? this.owner.repo.db
              .prepare(
                "SELECT first_seq,last_seq,data FROM core_stages WHERE session_id=? AND last_seq<=? ORDER BY last_seq DESC LIMIT 5",
              )
              .all(
                session,
                summaryView.summaries.length
                  ? summaryView.start - 1
                  : watermark,
              )
              .map((s) => ({
                first_seq: s.first_seq,
                last_seq: s.last_seq,
                summary: JSON.parse(s.data).summary,
                reliability:
                  "未核实的阶段线索，不是人物事实；冲突时以原文和记忆为准",
              }))
          : [];
      const view = this.owner.mind.view({
        session: preview?.viewSession || session,
        kind: privateChat ? "private" : "group",
        people,
        cue: batch.map((m) => ({
          role: m.role,
          userId: m.userId,
          text: m.text || "",
          relation: resolved.find((line) => line.id === m.seq)?.relation,
          mentioned: m.mentioned === true,
        })),
        now,
      });
      const snapshot = ownInitiative
        ? initiativeSnapshot(session, window, nature, now, policy.timeZone)
        : buildContext(
            this.owner.repo,
            session,
            watermark,
            model,
            policy,
            batchIds,
            memories,
            nature,
            now,
            {
              knowledge,
              stages,
              simulated: simulatedTurn,
              summaries: summaryView.summaries,
              coverage: summaryView.coverage,
              summaryStart: summaryView.start,
              self: view.self,
              inner: view.inner,
              nameOf: (id) => this.owner.mind.bonds.name(id),
              resolved,
            },
          );
      if (ownInitiative) {
        snapshot.self = view.self;
        snapshot.inner = view.inner;
      }
      const visionModel = model.vision
        ? model
        : this.owner.fallbackFor(null, model).find((item) => item.vision) ||
          model;
      const direct = snapshot.batch.some((m) => m.relation === "direct");
      const media = ownInitiative
        ? { images: [], unavailable: [] }
        : visionInputs(snapshot, visionModel, {
            selective: !!policy.selectiveVision,
          });
      const early = classifyVision(
        this.owner.repo.db,
        snapshot.sessionId,
        media.images,
      );
      const loaded = early.pending.length
        ? await this.owner.loadVisionImages(early.pending, {
            sessionId: snapshot.sessionId,
            fetchImage: this.owner.fetchImage,
          })
        : { images: [], unavailable: [] };
      const planned = classifyLoaded(
        this.owner.repo.db,
        snapshot.sessionId,
        loaded.images,
        {
          batchIds: snapshot.batchIds,
          direct,
          modelCanSee: !!model.vision,
        },
      );
      mergeVision(snapshot, [...early.cached, ...planned.cached]);
      if (early.cached.length || planned.cached.length)
        trace.steps.push("图片使用已保存的观察，不再提交画面");
      const describe = planned.describe;
      let show = planned.show.slice();
      if (!replay)
        snapshot.topics = this.owner.topics.recent(session, watermark, now);
      snapshot.unavailableImages = [
        ...media.unavailable,
        ...loaded.unavailable,
      ];
      trace.snapshot = { ...snapshot, sourceRows: undefined, batch: undefined };
      trace.config = {
        nature: { ...nature },
        policy,
        model: { ...model, apiKey: undefined },
        prompts: prompt,
      };
      trace.affect = view.affect;
      if (
        simulatedTurn &&
        !hasKey &&
        (preview || this.owner.store.settings().demo)
      )
        return this.owner.offline(
          session,
          batch,
          trace,
          finish,
          snapshot.messages,
          preview,
          state,
        );
      if (describe.length) {
        try {
          const observed = await models.call(
            visionModel,
            "vision",
            prompt.system +
              "\n" +
              prompt.vision +
              "\n每张图按 messageId 独立观察。description 只写可见元素、文字和表情语气；前后语境仅用来消歧，不把当前话题、发送意图或给谁看的猜测写进可缓存的描述。表情包台词不是事实，不从前一张图推断这一张。",
            {
              messages: visionWindow(snapshot.messages, [
                ...describe.map((image) => image.messageId),
                ...snapshot.batchIds,
              ]),
              batchIds: snapshot.batchIds,
            },
            trace,
            describe,
          );
          const paired = descriptionsFor(describe, observed);
          if (paired.length) {
            saveVision(this.owner.repo.db, snapshot.sessionId, paired);
            mergeVision(
              snapshot,
              paired.map(({ image, description }) => ({
                messageId: image.messageId,
                description,
              })),
            );
          } else if (
            observed &&
            typeof observed === "object" &&
            !snapshot.vision
          )
            snapshot.vision = observed;
        } catch (error) {
          trace.steps.push(
            `图片理解失败，本轮不根据画面编造：${error.message}`,
          );
          snapshot.unavailableImages.push(
            ...describe.map((image) => ({
              messageId: image.messageId,
              reason: "图片理解调用失败",
            })),
          );
          if (model.vision) show = show.concat(describe);
        }
      }
      if (snapshot.vision) trace.snapshot.vision = snapshot.vision;
      const generationImages = model.vision ? show : [];
      if (!replay && !preview) {
        const rounds = this.owner.repo.db
          .prepare(
            "SELECT COUNT(DISTINCT trace_id) n FROM core_outbox WHERE session_id=? AND time>? AND status IN ('confirmed','uncertain','sending')",
          )
          .get(session, this.owner.now() - 60000).n;
        const roundLimit = privateChat ? 30 : direct ? 20 : 6;
        if (rounds >= roundLimit)
          return finish("silent", `每分钟发言轮数限速（${roundLimit}轮）`);
      }
      const pressure = this.owner.mind.budget.pressure("conversation", now);
      const occasionData = occasion
        ? {
            type: occasion.type,
            note: OCCASIONS[occasion.type] || "",
            ...occasion.data,
          }
        : undefined;
      if (["presence", "outreach"].includes(occasion?.type)) {
        snapshot.initiative = occasionData;
        trace.snapshot = initiativeContext(snapshot);
      }
      if (
        live &&
        !occasion &&
        this.owner.batchMovedOn(session, batch, snapshot, privateChat)
      ) {
        trace.steps.push(
          "读房间的这几秒里，要回的人又说了话：先不花一次调用，并入下一批一起回",
        );
        return finish("stale", "读房间时又有新话，并入下一批");
      }
      let turn;
      try {
        turn = normalizeTurn(
          await takeTurn(
            models,
            model,
            replyPrompt(
              nature,
              prompt,
              snapshot.initiative ? "initiative" : "turn",
            ),
            snapshot,
            trace,
            {
              images: generationImages,
              occasion: occasionData,
              pressure:
                pressure >= 0.7 ? "今天已经说了很多话，能短就短" : undefined,
            },
          ),
          snapshot,
          trace,
        );
        if (generationImages.length)
          markVisionSeen(
            this.owner.repo.db,
            snapshot.sessionId,
            generationImages,
          );
      } catch (error) {
        if (!isFormatError(error)) throw error;
        trace.steps.push("回合输出格式异常，按直接对话兜底");
        if (["presence", "outreach"].includes(occasion?.type))
          return finish("error", "主动判断没有整理好，愿望保留，稍后重新决定");
        turn = normalizeTurn(
          {
            choice:
              direct && !["presence", "outreach"].includes(occasion?.type)
                ? "speak"
                : "silent",
            reason: "没能整理好想法",
          },
          snapshot,
          trace,
        );
      }
      trace.decision = turn;
      trace.path = occasion?.type || (direct ? "direct" : "contextual");
      const roomKind = privateChat ? "private" : "group";
      let talkSettled = false;
      const land = (spoke) => {
        if (!live || talkSettled) return;
        talkSettled = true;
        const choice =
          spoke || turn.choice === "silent" ? turn.choice : "silent";
        this.owner.mind.settleTalk(
          { ...turn, choice },
          {
            session,
            snapshot,
            kind: roomKind,
            spoke: choice !== "silent",
            withheld: !spoke && turn.choice !== "silent",
            sent: trace.sent || [],
            time: now,
          },
        );
        this.owner.mind.choose({
          session,
          traceId: trace.id,
          choice,
          appraisal: turn.appraisal,
          reason: choice === turn.choice ? turn.reason : "没发出去",
          watermark,
          occasion: occasion?.type || null,
          time: now,
        });
      };
      if (live) {
        this.owner.mind.look(session, watermark, now);
        this.owner.mind.experience(turn, {
          session,
          snapshot,
          kind: roomKind,
          spoke: false,
          deferTalk: true,
          time: now,
        });
      }
      if (!replay && !preview)
        this.owner.topics.record(session, trace.id, watermark, turn);
      if (turn.choice === "silent") {
        land(false);
        return finish("silent", turn.reason);
      }
      let spoken;
      try {
        spoken = await this.owner.speak({
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
          state,
          watermark,
          clearEpoch,
          privateChat,
          direct,
          simulatedTurn,
          replay,
          preview,
          pressure,
          generationImages,
          anchor,
        });
      } catch (error) {
        land(Array.isArray(trace.sent) && trace.sent.length > 0);
        trace.error = error.message;
        if (live && !trace.sent?.length && (privateChat || gate?.direct))
          this.owner.retryAfterOutage(session, batch, error, trace);
        return finish("error", error.message);
      }
      land(Array.isArray(spoken?.sent) && spoken.sent.length > 0);
      return spoken;
    } catch (e) {
      trace.error = e.message;
      if (live && !trace.sent?.length && (privateChat || gate?.direct))
        this.owner.retryAfterOutage(session, batch, e, trace);
      return finish("error", e.message);
    } finally {
      // Previews and demos are disposable by design: they never advance
      // memory cursors or create stages.
      if (live)
        try {
          this.owner.backgroundWork(session, policy);
        } catch {
          // Background upkeep must never turn a finished turn into an error.
        }
    }
  }
}
