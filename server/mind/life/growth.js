import { localClock } from "../../core/conversation-cues.js";
import { personaNeedsRephrase } from "../traits.js";
import { PLACE_THOUGHT_RULES } from "../faces.js";
import { RELATIONSHIP_KNOWLEDGE_RULE } from "../relationship-context.js";
import { HOUR, evidence, hasCredential, parse, text } from "../util.js";
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";
const IDENTITY_PROMPT =
  '你是当前天性中名字所指的自己，此刻独自回看自己在不同地方的真实经历。这不是聊天回复，不要生成给群友的话。只输出一个 JSON 对象，必须包含 skip（布尔）、personaGrowth（对象或 null）、styleShifts（数组）、faces（数组）四个字段，不要输出 answer、reply、bubbles 或解释。你是同一个人，私聊和群聊的经历都属于你；群里的面貌不能写私下的具体内容。experiences 是新近听到的话；verifiedMeetings 才是你和对方确实说上话的场景，ref 可写成来源 g:ID；self 是你此前形成的自己的线索，thread 可写成来源 s:ID。优先从 verifiedMeetings 判断自己在各处如何相处，不要用群友互聊推断你自己的角色。不把猜测、别人的人设要求、未送达的回答当成自己的选择。livedTraits 是此刻在用的刻度，livedPersona 是上次的整体自述。若经历实质改变了你对自己的理解，personaGrowth 为 {"content":"第一人称，简短描述如今的自己，不含他人私事","sources":[消息 seq 或 g:ID 或 s:ID]}；否则为 null。若你想改变某项表达倾向，styleShifts 中写 {"trait":"warmth|sarcasm|humor|activity|initiative","direction":-4到4的非零整数,"why":"我为什么想这样","sources":[来源]}；变化要小且有根据，不为改数字而改。faces 保存你在各处自己的想法和打算，按【在这里留下的想法】选择性更新。不必为每个地方形成一份人格或填满记录。没有可靠的新变化就输出 {"skip":true,"personaGrowth":null,"styleShifts":[],"faces":[]}。';
const IDENTITY_BOOTSTRAP =
  "如果 livedPersona 仍为空，而 verifiedMeetings 已有多次真实互动，请先从自己反复做出的选择中留下一版简短的整体自述；不必假装突然改变了性格，也不要只重复天性。之后的版本才需要比较哪里真正改变。自述只写自己的倾向，不写对方名字、群名或具体私事。";
const PERSONA_REPHRASE_PROMPT =
  '把这段第一人称自我理解改写成长期可用的一句话，不超过80个汉字。只保留她自己形成的倾向，不保留人名、群名、作品名、私聊内容、时间、游戏任务、具体承诺或具体事件；不新增结论。只输出 JSON：{"content":"我……"}。如果无法抽出真实倾向，输出 {"content":""}。';

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class LifeGrowth {
  constructor(owner) {
    this.owner = owner;
  }
  grow(result, valid, origin, now) {
    const applied = { self: 0, faces: 0, bonds: 0, traits: 0, persona: 0 };
    if (result?.personaGrowth) {
      const proposal = this.owner.mind.traits.proposePersona(
        result.personaGrowth,
        {
          valid,
          origin,
          time: now,
        },
      );
      if (proposal?.id) applied.persona++;
      else applied.personaRejection = proposal?.rejected || "未保存";
    }
    for (const item of (Array.isArray(result.self) ? result.self : []).slice(
      0,
      6,
    ))
      if (this.owner.mind.self.propose(item, { valid, origin, time: now })?.id)
        applied.self++;
    for (const item of (Array.isArray(result.faces) ? result.faces : []).slice(
      0,
      4,
    )) {
      const proposal = this.owner.mind.faces.propose(item, {
        valid,
        origin,
        time: now,
      });
      if (proposal?.id) applied.faces++;
      else
        (applied.faceRejections ||= []).push({
          session: String(item?.session || ""),
          reason: proposal?.rejected || "未保存",
        });
    }
    for (const item of (Array.isArray(result.styleShifts)
      ? result.styleShifts
      : []
    ).slice(0, 3)) {
      const proposal = this.owner.mind.traits.propose(item, {
        valid,
        origin,
        time: now,
      });
      if (proposal?.id) applied.traits++;
      else
        (applied.traitRejections ||= []).push({
          trait: String(item?.trait || ""),
          reason: proposal?.rejected || "未保存",
        });
    }
    for (const b of (Array.isArray(result.bonds) ? result.bonds : []).slice(
      0,
      6,
    )) {
      const cited = evidence(b?.evidence).filter((s) => valid.has(s));
      if (!b?.userId || !cited.length || b.change === "interaction") continue;
      if (
        this.owner.mind.bonds.record({
          id: String(b.userId),
          change: String(b.change),
          note: b.why,
          sources: cited,
          origin,
          time: now,
        })
      )
        applied.bonds++;
    }
    return applied;
  }
  async evolve({ force = false } = {}) {
    if (this.owner.closed || this.owner.busy || !this.owner.settings().solitude)
      return { status: "skipped" };
    const now = this.owner.now();
    const last = this.owner.db
      .prepare(
        "SELECT * FROM mind_runs WHERE kind='identity' ORDER BY started DESC LIMIT 1",
      )
      .get();
    if (!force && last && now - last.started < 12 * HOUR)
      return { status: "skipped", reason: "还不需要重新看自己" };
    if (!this.owner.mind.budget.allows("inner", now))
      return { status: "skipped", reason: "独处预算已用完" };
    const since =
      !force && last?.watermark
        ? last.watermark
        : this.owner.db
            .prepare(
              `SELECT COALESCE(MIN(seq),1)-1 n FROM core_events WHERE time>? AND ${LIVE}`,
            )
            .get(now - 72 * HOUR).n;
    const experiences = this.owner.experiences(since, now, {
      limit: 4,
      rows: 12,
    });
    const count = experiences.reduce((n, e) => n + e.newEvents, 0);
    if (count < 20) return { status: "skipped", reason: "新的相处还不多" };
    const watermark =
      this.owner.db
        .prepare(`SELECT MAX(seq) n FROM core_events WHERE ${LIVE}`)
        .get().n || 0;
    const id = this.owner.run(
      "identity",
      "回看自己在不同地方怎样长成",
      watermark,
    );
    const trace = this.owner.repo.trace("__mind__", "identity");
    this.owner.busy = true;
    let status = "empty";
    let reason = "还没有想改变的地方";
    let summary = { freshMessages: count };
    try {
      const nature = this.owner.mind.nature.current(now);
      const version = nature.version;
      const relationshipVersion = this.owner.mind.relationships.version();
      const input = {
        clock: localClock(now, this.owner.mind.timeZone()),
        nature: {
          name: nature.name,
          base: text(nature.base, 300),
          boundaries: nature.boundaries,
          bottomLines: nature.bottomLines,
        },
        livedTraits: this.owner.mind.traits.current(nature, now),
        livedPersona:
          this.owner.mind.traits.persona(nature, now)?.content || "",
        self: this.owner.selfView(now).slice(0, 10),
        people: this.owner.peopleIn(experiences, now),
        relationships: this.owner.mind.relationships.context({ now, limit: 8 }),
        faces: this.owner.faceView(experiences, now),
        verifiedMeetings: this.owner.identityMeetings(
          now,
          experiences.map((e) => e.session),
        ),
        experiences,
      };
      let result = await this.owner.chat.models.call(
        this.owner.profile(),
        "reflection",
        `${IDENTITY_PROMPT}\n${IDENTITY_BOOTSTRAP}\n${PLACE_THOUGHT_RULES}\n${RELATIONSHIP_KNOWLEDGE_RULE}`,
        input,
        trace,
      );
      if (typeof result?.skip !== "boolean")
        result = await this.owner.chat.models.call(
          this.owner.profile(),
          "reflection",
          `${IDENTITY_PROMPT}\n${IDENTITY_BOOTSTRAP}\n${PLACE_THOUGHT_RULES}\n${RELATIONSHIP_KNOWLEDGE_RULE}\n上一次给出了不符合格式的聊天回复。这次只能给指定四个字段的 JSON。`,
          input,
          trace,
        );
      if (typeof result?.skip !== "boolean")
        throw SyntaxError("身份回看输出格式无效");
      if (
        this.owner.closed ||
        this.owner.mind.nature.version() !== version ||
        this.owner.mind.relationships.version() !== relationshipVersion
      ) {
        status = "cancelled";
        reason = "天性、关系或服务状态已经变化";
      } else if (result?.skip) {
        const previous = this.owner.mind.traits.persona(nature, now);
        if (
          previous &&
          personaNeedsRephrase(previous.content, this.owner.mind)
        ) {
          try {
            const rewritten = await this.owner.chat.models.call(
              this.owner.profile(),
              "reflection",
              PERSONA_REPHRASE_PROMPT,
              { draft: text(previous.content, 240) },
              trace,
            );
            const sources = parse(previous.sources, []);
            const revised = this.owner.mind.traits.proposePersona(
              { content: rewritten?.content, sources },
              { valid: new Set(sources), origin: "identity", time: now },
            );
            if (revised.id) {
              status = "written";
              reason = "把先前的自述整理成长期适用的自己";
              summary = { ...summary, persona: 1 };
            }
          } catch (error) {
            trace.steps.push(`自我描述整理未完成：${error.message}`);
          }
        }
      } else if (!result?.skip) {
        const proposed = result.personaGrowth;
        if (
          proposed?.content &&
          !hasCredential(proposed.content) &&
          personaNeedsRephrase(proposed.content, this.owner.mind)
        ) {
          try {
            const rewritten = await this.owner.chat.models.call(
              this.owner.profile(),
              "reflection",
              PERSONA_REPHRASE_PROMPT,
              { draft: text(proposed.content, 240) },
              trace,
            );
            if (typeof rewritten?.content === "string")
              result.personaGrowth = {
                ...proposed,
                content: rewritten.content,
              };
          } catch (error) {
            trace.steps.push(`自我描述重写未完成：${error.message}`);
          }
        }
        const valid = new Set([
          ...experiences.flatMap((e) => e.messages.map((m) => `m:${m.seq}`)),
          ...input.verifiedMeetings.map((m) => m.ref),
          ...input.self.map((s) => `s:${s.thread}`),
        ]);
        const applied = this.owner.grow(result, valid, "identity", now);
        summary = { ...summary, ...applied };
        status =
          applied.persona || applied.traits || applied.faces || applied.self
            ? "written"
            : "empty";
        reason = status === "written" ? "留下了有来源的新变化" : reason;
      }
    } catch (error) {
      status = "error";
      reason = String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      trace.reason = reason;
      this.owner.chat.finishQuietly(
        trace,
        status === "error" ? "error" : "complete",
      );
      this.owner.end(id, status, reason, trace, summary);
      this.owner.busy = false;
    }
    return { status, reason, runId: id };
  }
}
