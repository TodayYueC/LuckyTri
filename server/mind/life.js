import { randomUUID } from "node:crypto";
import { evidenceRoots } from "./evidence.js";
import { localClock } from "../core/conversation-cues.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { estimateTokens } from "../core/model-manager.js";
import { elapsedLabel } from "./clock.js";
import { isPrivateSession } from "./memory.js";
import { lifeDayKey, rhythmPhase } from "./nature.js";
import { THOUGHT_KINDS } from "./thoughts.js";
import { Initiative } from "./initiative.js";
import { OwnVoice } from "./own-voice.js";
import {
  DAY,
  HOUR,
  clamp,
  evidence,
  hasCredential,
  parse,
  similar,
  text,
} from "./util.js";
export const LIFE_DEFAULTS = {
  solitude: true,
  proactive: true,
  diary: true,
  reading: true,
  night: true,
  idleMinutes: 20,
  intervalMinutes: 90,
  minMessages: 6,
  chapterDays: 7,
  proactiveIntervalHours: 0,
  initiativeIntervalMinutes: 30,
  modelId: "",
  timeZone: "Asia/Shanghai",
};
const MINUTE = 60000;
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";
const SOLITUDE_INPUT_CAP = 24000;
import { LifeContext } from "./life-context.js";
import { LifeGrowth } from "./life-growth.js";
import { LifeDiary } from "./life-diary.js";
import { LifePresence } from "./life-presence.js";
import { LifeActivities } from "./life-activities.js";
import { OwnDay } from "./own-day.js";
import { DayPlanner } from "./day-planner.js";

export class Life {
  constructor(chat, { now = chat.now || Date.now, online = () => false } = {}) {
    this.chat = chat;
    this.mind = chat.mind;
    this.repo = chat.repo;
    this.db = chat.repo.db;
    this.now = now;
    this.mind.time.now = now;
    this.mind.time.search.bind(this);
    this.online = online;
    this.busy = false;
    this.closed = false;
    this.initiative = new Initiative(this);
    this.ownVoice = new OwnVoice(this);
    this.context = new LifeContext(this);
    this.growth = new LifeGrowth(this);
    this.journal = new LifeDiary(this);
    this.presence = new LifePresence(this);
    this.activities = new LifeActivities(this);
    this.ownDay = new OwnDay(this);
    this.planner = new DayPlanner(this);
  }
  settings() {
    return { ...LIFE_DEFAULTS, ...this.repo.config("life", {}) };
  }
  save(value) {
    const next = { ...this.settings(), ...value };
    for (const key of ["solitude", "proactive", "diary", "reading", "night"])
      if (typeof next[key] !== "boolean") throw Error("开关无效");
    localClock(this.now(), next.timeZone);
    for (const [key, min, max] of [
      ["idleMinutes", 0, 1440],
      ["intervalMinutes", 10, 10080],
      ["minMessages", 0, 10000],
      ["chapterDays", 1, 365],
      ["initiativeIntervalMinutes", 1, 10080],
    ])
      if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max)
        throw Error(`${key} 超出范围`);
    if (
      !Number.isFinite(next.proactiveIntervalHours) ||
      next.proactiveIntervalHours < 0 ||
      next.proactiveIntervalHours > 8760
    )
      throw Error("proactiveIntervalHours 超出范围");
    next.modelId = "";
    this.repo.saveConfig(
      "life",
      Object.fromEntries(Object.keys(LIFE_DEFAULTS).map((k) => [k, next[k]])),
    );
    return this.settings();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), MINUTE);
    this.timer.unref();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
  phase(now = this.now()) {
    return rhythmPhase(
      this.mind.nature.current(now),
      now,
      this.mind.timeZone(),
    );
  }
  // A day of her life starts when she wakes, not at midnight.
  lifeDay(now = this.now()) {
    return lifeDayKey(this.mind.nature.current(now), now, this.mind.timeZone());
  }
  living({ memory = true } = {}) {
    return this.db
      .prepare(
        "SELECT id,name,kind FROM sessions WHERE enabled=1 AND archived=0",
      )
      .all()
      .filter(
        (s) =>
          this.chat.enabled(s.id, { simulated: false }) &&
          (!memory || this.chat.policy(s.id).memory !== false),
      );
  }
  profile() {
    return this.chat.models.profile();
  }
  run(kind, reason, watermark = null) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_runs(id,kind,started,status,reason,watermark) VALUES (?,?,?,'running',?,?)",
      )
      .run(id, kind, this.now(), reason, watermark);
    this.repo.store.revision++;
    return id;
  }
  end(id, status, reason, trace, summary = null) {
    const tokens = (trace?.calls || []).reduce(
      (n, c) =>
        n +
        (c.tokens
          ? Number(c.tokens.input || 0) + Number(c.tokens.output || 0)
          : Number(c.usage?.total_tokens) || 0),
      0,
    );
    this.db
      .prepare(
        "UPDATE mind_runs SET finished=?,status=?,reason=?,tokens=?,model=?,summary=? WHERE id=?",
      )
      .run(
        this.now(),
        status,
        String(reason).slice(0, 300),
        tokens,
        trace?.calls?.[0]?.model?.model || null,
        summary ? JSON.stringify(summary) : null,
        id,
      );
    this.db
      .prepare(
        "DELETE FROM mind_runs WHERE started<? AND id NOT IN (SELECT id FROM mind_runs ORDER BY started DESC LIMIT 400)",
      )
      .run(this.now() - 30 * DAY);
    this.repo.store.revision++;
  }
  runs(limit = 60) {
    return this.db
      .prepare("SELECT * FROM mind_runs ORDER BY started DESC LIMIT ?")
      .all(limit)
      .map((r) => ({ ...r, summary: parse(r.summary, null) }));
  }
  async tick() {
    if (this.closed || this.busy)
      return { status: "skipped", reason: "已有后台任务或服务已停止" };
    const now = this.now();
    this.mind.time.tasks.sync(now);
    this.mind.time.tick(now);
    this.mind.days.rollup(now);
    const phase = this.phase(now).key;
    if (phase !== "asleep") {
      const woke = await this.wake(now);
      if (woke) return woke;
    }
    const due = this.diaryDue(now);
    if (this.mind.time.primary() && this.mind.time.attention.activityBusy)
      return { status: "doing", reason: "正在推进自己的活动步骤" };
    if (this.mind.time.primary() && (due || this.nightDue(now)))
      this.mind.time.tasks.control(
        this.mind.time.primary().id,
        {
          action: "pause",
          readyAt: now + this.mind.time.settings().breakMinutes * 60000,
          reason: "先写日记或整理今天，保留续接位置",
        },
        now,
      );
    if (due) return this.review(due);
    const night = this.nightDue(now);
    if (night)
      return night.kind === "memory"
        ? this.rememberAtNight(night.session, night.day, now)
        : this.reviewPeriod(now);
    const arrangement = await this.planner.run(now);
    if (arrangement) return arrangement;
    const care = await this.ownDay.run(now);
    if (care) return care;
    const activity = await this.activities.run(now);
    if (activity) return activity;
    if (this.mind.time.primary())
      return {
        status: "doing",
        reason: "自己的活动在继续，普通交流可以伴随进行",
      };
    const outreach = await this.reachOut(now);
    if (outreach) return outreach;
    const reason = this.eligible(now);
    if (!reason) {
      const reflection = await this.reflect();
      const growth = await this.evolve();
      // A wish for now is not silently turned into a wish for the next tick.
      const contact = await this.reachOut(this.now());
      if (contact) return { ...contact, reflection, growth };
      const presence = await this.considerPresence(this.now());
      return presence && presence.status !== "presence-silent"
        ? { ...presence, reflection, growth }
        : {
            ...reflection,
            ...(growth ? { growth } : {}),
            ...(presence ? { expression: presence } : {}),
          };
    }
    const presence = await this.considerPresence(now);
    if (presence) return presence;
    return { status: "skipped", reason };
  }
  // Direct messages that came in while she slept.
  async wake(now = this.now()) {
    let last = null;
    for (const session of this.mind.deferred()) {
      const unread = this.mind.unread(session, { now });
      if (!unread.length) {
        this.mind.look(session, this.repo.latest(session), now);
        continue;
      }
      const trace = await this.chat.initiate(session, { type: "wake" }, unread);
      if (trace) last = { status: trace.status, reason: trace.reason, session };
      // Seen once is seen: a failed look is not retried every minute.
      this.mind.look(session, unread.at(-1).seq, now);
    }
    return last;
  }
  eligible(now = this.now()) {
    if (this.mind.time.primary()) return "正在做自己的事";
    const s = this.settings();
    if (!s.solitude) return "独处未开启";
    if (this.phase(now).key === "asleep") return "睡着了";
    if (!this.mind.budget.allows("inner", now))
      return "今天用于独处的预算已经用完";
    try {
      this.profile();
    } catch {
      return "尚未配置模型";
    }
    const sessions = this.living();
    if (!sessions.length) return "没有正在参与、开启记忆的会话";
    const ids = sessions.map((x) => x.id);
    const marks = ids.map(() => "?").join(",");
    const recent = this.db
      .prepare(
        `SELECT MAX(time) t FROM core_events WHERE session_id IN (${marks}) AND seq NOT IN (SELECT seq FROM mind_unlived) AND ${LIVE}`,
      )
      .get(...ids).t;
    if (!recent) return "还没有真实的经历";
    if (s.idleMinutes > 0 && now - recent < s.idleMinutes * MINUTE)
      return "还在聊天，等一个安静的空隙";
    if (
      this.db
        .prepare(
          `SELECT 1 FROM core_jobs WHERE session_id IN (${marks}) AND status IN ('pending','running') LIMIT 1`,
        )
        .get(...ids)
    )
      return "对话处理中";
    const last = this.db
      .prepare(
        "SELECT * FROM mind_runs WHERE kind='solitude' AND status NOT IN ('interrupted') ORDER BY started DESC LIMIT 1",
      )
      .get();
    if (last && now - last.started < s.intervalMinutes * MINUTE)
      return "距离上次独处太近";
    const fresh = this.db
      .prepare(
        `SELECT COUNT(*) n FROM core_events WHERE session_id IN (${marks}) AND role='user' AND seq>? AND seq NOT IN (SELECT seq FROM mind_unlived) AND ${LIVE}`,
      )
      .get(...ids, last?.watermark || 0).n;
    const revisit = this.db
      .prepare(
        "SELECT 1 FROM mind_thoughts WHERE status='open' AND hidden=0 AND outreach_status!='planned' AND revisit_at<=? AND revisit_at>? LIMIT 1",
      )
      .get(now, last?.started || 0);
    const feedback = this.db
      .prepare("SELECT 1 FROM reply_feedback WHERE time>? LIMIT 1")
      .get(last?.started || 0);
    // Something unread on the shelf is reason enough for a quiet hour now
    // and then, even when nothing new has happened.
    const shelf =
      s.reading &&
      (!last || now - last.started >= 6 * HOUR) &&
      this.mind.reading.unreadCount() > 0;
    // Something she was waiting for has come near, or just went by.
    const ahead = this.mind.anticipations.newlyDue(last?.started || 0, now);
    const timeToSelf =
      now - recent >= Math.max(s.idleMinutes, s.intervalMinutes) * MINUTE &&
      this.initiative.contacts(now).length > 0;
    if (
      (fresh === 0 || fresh < s.minMessages) &&
      !revisit &&
      !feedback &&
      !shelf &&
      !ahead &&
      !timeToSelf
    )
      return fresh ? "新经历还不多" : "没有新的经历";
    // Nothing but the time passing is the reason, and the last runs on
    // that reason found nothing: wait longer each time until something new
    // comes in, instead of asking again on the same clock.
    const onlyTime =
      (fresh === 0 || fresh < s.minMessages) &&
      !revisit &&
      !feedback &&
      !shelf &&
      !ahead;
    if (onlyTime && last) {
      let empties = 0;
      for (const run of this.db
        .prepare(
          "SELECT status FROM mind_runs WHERE kind='solitude' AND status NOT IN ('interrupted') ORDER BY started DESC LIMIT 6",
        )
        .all()) {
        if (run.status !== "empty") break;
        empties++;
      }
      if (
        empties >= 2 &&
        now - last.started <
          Math.min(6 * HOUR, s.intervalMinutes * MINUTE * 2 ** (empties - 1))
      )
        return "连着几次独处都没有新的理解，等新的经历";
    }
    return null;
  }

  experiences(...args) {
    return this.context.experiences(...args);
  }

  feedbackSince(...args) {
    return this.context.feedbackSince(...args);
  }

  selfView(...args) {
    return this.context.selfView(...args);
  }

  livingForView(...args) {
    return this.context.livingForView(...args);
  }

  faceView(...args) {
    return this.context.faceView(...args);
  }

  identityMeetings(...args) {
    return this.context.identityMeetings(...args);
  }
  // Threads slipping out of view: she may let them go or, with something
  // new behind it, hold on.

  fadingView(...args) {
    return this.context.fadingView(...args);
  }
  // People she has grown close to. Their last message is what she can
  // point at when she thinks of them.

  bondCards(...args) {
    return this.context.bondCards(...args);
  }

  missingView(...args) {
    return this.context.missingView(...args);
  }
  // Close people she still sees, and has not talked with for a while.

  quietView(...args) {
    return this.context.quietView(...args);
  }
  // Sessions a citation actually rests on. A thought that also lists a
  // private room only counts as private when it has no public room.

  sourcePlaces(...args) {
    return this.context.sourcePlaces(...args);
  }
  // Where a thought came from decides where a plan built on it may surface:
  // anything rooted in a private chat stays there.

  placeOf(...args) {
    return this.context.placeOf(...args);
  }
  // Her own plans, and endings for things she was looking ahead to. Only
  // what she was shown can be closed, and only with something behind it.
  anticipate(result, { valid, shown, origin, now }) {
    const applied = { plans: 0, closed: 0 };
    for (const plan of (Array.isArray(result?.plans) ? result.plans : []).slice(
      0,
      3,
    )) {
      const sources = evidence(plan?.sources).filter((s) => valid.has(s));
      if (!sources.length) continue;
      const added = this.mind.anticipations.add({
        kind: "plan",
        activity: plan?.activity,
        content: plan?.content,
        due: plan?.due,
        sources,
        origin,
        time: now,
        ...this.placeOf(sources),
      });
      if (added.id) applied.plans++;
      else if (!plan?.due) {
        const task = this.mind.time.tasks.add(
          {
            kind: "plan",
            activity: plan?.activity,
            title: plan?.content,
            why: text(plan?.why, 240) || "这次自己选择留下的打算",
            sources,
            ...this.placeOf(sources),
          },
          now,
        );
        if (task.id) applied.plans++;
      }
    }
    for (const item of (Array.isArray(result?.closeAnticipations)
      ? result.closeAnticipations
      : []
    ).slice(0, 6)) {
      const id = String(item?.id ?? "").replace(/^a:/, "");
      if (!shown.has(id)) continue;
      const sources = evidence(item?.sources).filter((s) => valid.has(s));
      if (item?.status !== "let_go" && !sources.length) continue;
      if (
        this.mind.anticipations.close(id, {
          status: item?.status,
          note: item?.why,
          sources,
          time: now,
        })
      )
        applied.closed++;
    }
    return applied;
  }
  // Thoughts she decided to put down. Only ones she was shown can be let go.
  letGo(items, shown, now) {
    let count = 0;
    for (const item of (Array.isArray(items) ? items : []).slice(0, 6)) {
      const id = String(item?.id ?? item ?? "").replace(/^t:/, "");
      if (!shown.has(id)) continue;
      if (this.mind.thoughts.resolve(id, text(item?.why, 120) || "放下了", now))
        count++;
    }
    return count;
  }

  peopleIn(...args) {
    return this.context.peopleIn(...args);
  }
  // Applies what she concluded about herself, her faces and people. Every
  // change must cite something she actually lived through.

  grow(...args) {
    return this.growth.grow(...args);
  }
  // A narrower, infrequent look at her own direction. General reflection had
  // too many jobs and usually returned skip even after busy days, leaving
  // numeric tendencies and group faces permanently at their seed values.

  async evolve(...args) {
    return this.growth.evolve(...args);
  }
  async reflect() {
    if (this.mind.time.attention.activityBusy)
      return { status: "skipped", reason: "自己的活动步骤尚未结束" };
    if (this.mind.time.primary())
      return { status: "skipped", reason: "正在做自己的事，保留专注时段" };
    this.busy = true;
    const now = this.now();
    const s = this.settings();
    const last = this.db
      .prepare(
        "SELECT * FROM mind_runs WHERE kind='solitude' ORDER BY started DESC LIMIT 1",
      )
      .get();
    const watermark =
      this.db.prepare(`SELECT MAX(seq) n FROM core_events WHERE ${LIVE}`).get()
        .n || 0;
    const since = last?.watermark
      ? Math.min(last.watermark, watermark)
      : this.db
          .prepare(
            `SELECT COALESCE(MIN(seq),1)-1 n FROM core_events WHERE time>? AND ${LIVE}`,
          )
          .get(now - 36 * HOUR).n;
    const id = this.run("solitude", "安静下来，重新看看最近的事", watermark);
    const trace = this.repo.trace("__mind__", "solitude");
    let status = "empty";
    let reason = "没有新的理解";
    let summary = null;
    let freshMessages = 0;
    try {
      const nature = this.mind.nature.current(now);
      const version = nature.version;
      const experiences = this.experiences(since, now);
      freshMessages = experiences.reduce((n, e) => n + e.messages.length, 0);
      const thoughts = this.mind.thoughts.open({ now, limit: 10 });
      const chunk = s.reading ? this.mind.reading.next(now) : null;
      const chapter = this.chapterView(now);
      const livingFor = this.livingForView(now);
      const input = {
        ...(chunk ? { reading: this.mind.reading.passage(chunk) } : {}),
        clock: localClock(now, this.mind.timeZone()),
        currentLife: this.mind.time.view({ now }),
        actions: this.mind.time.lived({
          since: last?.started || now - DAY,
          before: now,
        }),
        ...(chapter ? { chapter } : {}),
        mood: (({ mood, cause, energyLabel, phaseLabel }) => ({
          mood,
          cause,
          energy: energyLabel,
          phase: phaseLabel,
        }))(this.mind.affect.state(now, { nature })),
        self: this.selfView(now),
        livedTraits: this.mind.traits.current(nature, now),
        livedPersona: this.mind.traits.persona(nature, now)?.content || "",
        initiative: { contacts: this.initiative.contacts(now) },
        ...(livingFor ? { livingFor } : {}),
        fading: this.fadingView(now),
        faces: this.faceView(experiences, now),
        people: this.peopleIn(experiences, now),
        missing: this.missingView(now),
        fromWish: this.mind.meetings.wishAway({ now }),
        quiet: this.quietView(now),
        ahead: this.mind.anticipations.due({ now, limit: 5 }),
        thoughts: thoughts.map((t) => ({
          id: t.id,
          kind: THOUGHT_KINDS[t.kind],
          when: elapsedLabel(t.created, now, this.mind.timeZone()),
          content: text(t.content, 200),
          ...(t.revisit_at && t.revisit_at <= now ? { due: true } : {}),
        })),
        feedback: this.feedbackSince(last?.started || now - DAY),
        experiences,
        meetings: this.mind.meetings.held({
          since: last?.started || now - 36 * HOUR,
          before: now,
          limit: 6,
        }),
      };
      if (!input.missing.length) delete input.missing;
      if (input.fromWish?.length && input.missing)
        input.fromWish = input.fromWish.filter(
          (p) => !input.missing.some((m) => m.userId === p.userId),
        );
      if (!input.fromWish.length) delete input.fromWish;
      if (!input.quiet?.length) delete input.quiet;
      if (!input.fading.length) delete input.fading;
      if (!input.ahead.length) delete input.ahead;
      if (!input.meetings.length) delete input.meetings;
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.experiences.some((e) => e.messages.length > 4)
      )
        for (const e of input.experiences)
          if (e.messages.length > 4) e.messages.shift();
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.meetings?.length > 2
      )
        input.meetings.shift();
      const result = await this.chat.models.call(
        this.profile(),
        "reflection",
        replyPrompt(nature, prompts(this.repo), "reflection") +
          '\nplans 可以是留给自己做的事；确实想在资料书架阅读、写短文、独处思考或接触游戏资料时，可加 activity:"read"|"write"|"think"|"game"，并写清content中的游戏名、why动机。game通过剧情、场景与人物互动推进游玩，直接记录自己的进度和感受。不为增加任务而列计划。',
        input,
        trace,
      );
      const involved = experiences.map((e) => e.session);
      // New messages while she was thinking do not undo what she understood
      // about what came before; they only make a planned word there stale.
      const stirred = new Set(
        involved.filter((session) =>
          this.repo
            .eventsAfter(session, watermark, { simulated: false })
            .some((m) => m.role === "user"),
        ),
      );
      if (this.closed || this.mind.nature.version() !== version) {
        if (chunk && !this.closed)
          this.mind.reading.record(chunk, result?.readingNote || "", id, now);
        status = "cancelled";
        reason = this.closed
          ? "服务停止了，这次想法不作数"
          : "天性改了，这次想法不作数";
      } else if (
        result?.skip === true &&
        !result.mood &&
        !result.outreach?.text
      ) {
        if (chunk)
          this.mind.reading.record(chunk, result?.readingNote || "", id, now);
        status = chunk ? "written" : "empty";
        reason = chunk ? `读了《${chunk.title}》，没多想` : reason;
        if (chunk) summary = { read: chunk.title };
      } else {
        const missing = input.missing || [];
        const ahead = input.ahead || [];
        const valid = new Set([
          ...input.actions.map((a) => a.ref),
          ...experiences.flatMap((e) => e.messages.map((m) => `m:${m.seq}`)),
          ...thoughts.map((t) => `t:${t.id}`),
          ...input.feedback.map((f) => f.ref),
          ...(chunk ? [`r:${chunk.id}`] : []),
          ...(input.livingFor ? [`s:${input.livingFor.thread}`] : []),
          ...input.self.map((s) => `s:${s.thread}`),
          ...input.initiative.contacts.flatMap((c) =>
            [...c.recent, ...c.thoughts].map((m) => m.ref),
          ),
          ...(input.meetings || []).map((m) => m.ref),
          ...(input.fromWish || []).map((p) => p.ref),
          ...(input.quiet || []).map((p) => p.ref).filter(Boolean),
          ...missing.map((p) => p.ref).filter(Boolean),
          ...ahead.map((a) => a.ref),
        ]);
        if (chunk)
          this.mind.reading.record(chunk, result?.readingNote || "", id, now);
        const noted = this.writeThought(result?.thought, {
          valid,
          thoughts,
          involved,
          reachable: new Set([
            ...involved,
            ...missing.flatMap((p) => p.sessions),
            ...(input.fromWish || []).map((p) => p.session),
            ...(input.quiet || []).flatMap((p) => p.sessions),
            ...input.initiative.contacts.map((c) => c.session),
            ...ahead.map((a) => a.session).filter(Boolean),
          ]),
          id,
          now,
          // New messages are considered at delivery, not a reason to erase a wish.
          outreach: s.proactive ? result?.outreach : null,
        });
        const applied = result?.skip
          ? { self: 0, faces: 0, bonds: 0, traits: 0, persona: 0 }
          : this.grow(result, valid, "solitude", now);
        applied.letGo = this.letGo(
          result?.letGo,
          new Set(thoughts.map((t) => t.id)),
          now,
        );
        Object.assign(
          applied,
          this.anticipate(result, {
            valid,
            shown: new Set(ahead.map((a) => a.ref.slice(2))),
            origin: "solitude",
            now,
          }),
        );
        if (result?.mood?.feeling && !stirred.size)
          this.mind.affect.feel({
            feeling: result.mood.feeling,
            intensity: clamp(result.mood.intensity ?? 0.25, 0, 0.6),
            valence: result.mood.valence,
            cause: noted ? text(result.thought?.content, 80) : "独处",
            origin: "solitude",
            time: now,
          });
        summary = {
          thought: noted,
          ...(noted && this.mind.thoughts.get(noted)?.outreach
            ? {
                outreach: {
                  session: this.mind.thoughts.get(noted).outreach_session,
                  reason: this.mind.thoughts.get(noted).outreach_reason,
                  at: this.mind.thoughts.get(noted).outreach_at,
                },
              }
            : {}),
          ...applied,
          ...(chunk ? { read: chunk.title } : {}),
          ...(stirred.size ? { interrupted: [...stirred] } : {}),
        };
        status =
          noted ||
          applied.self ||
          applied.faces ||
          applied.traits ||
          applied.persona ||
          applied.bonds ||
          applied.letGo ||
          applied.plans ||
          applied.closed ||
          chunk
            ? "written"
            : result?.mood?.feeling && !stirred.size
              ? "state"
              : "empty";
        reason =
          (stirred.size ? "想着想着又有了新对话；" : "") +
          (status === "written"
            ? chunk
              ? `读了《${chunk.title}》，${noted || applied.self ? "留下了新的理解" : "没多想"}`
              : "留下了新的理解"
            : status === "state"
              ? "没有新想法，但心情有了变化"
              : "没有新的理解");
      }
    } catch (error) {
      status = "error";
      reason = /timeout|abort/i.test(error.name)
        ? "独处时模型超时"
        : error instanceof SyntaxError
          ? "独处输出格式无效，未保存"
          : String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      trace.reason = reason;
      this.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      this.end(id, status, reason, trace, { ...summary, freshMessages });
      this.busy = false;
    }
    return { status, reason, runId: id };
  }
  writeThought(
    thought,
    {
      valid,
      thoughts,
      involved,
      reachable = new Set(involved),
      id,
      now,
      outreach,
    },
  ) {
    let reach =
      outreach &&
      typeof outreach.text === "string" &&
      outreach.text.trim() &&
      reachable.has(outreach.session) &&
      !hasCredential(outreach.text)
        ? outreach
        : null;
    // Wanting to say something does not require inventing a new revelation.
    if ((!thought || typeof thought !== "object") && reach)
      thought = {
        kind: "reconnection",
        content: reach.reason || `想说：${reach.text}`,
        sources: reach.sources || [],
      };
    if (!thought || typeof thought !== "object") return null;
    const content = text(thought.content, 600);
    if (!content || hasCredential(content)) return null;
    const cited = evidence([
      ...(Array.isArray(thought.sources) ? thought.sources : []),
      ...(Array.isArray(reach?.sources) ? reach.sources : []),
    ]);
    const sources = cited.filter((x) => valid.has(x));
    if (!sources.length && (cited.length || !reach)) return null;
    const parent = thought.parentId
      ? thoughts.find((t) => t.id === thought.parentId) ||
        this.mind.thoughts.get(thought.parentId)
      : null;
    if (thought.parentId && !parent) return null;
    if (thought.kind === "revision" && !parent) return null;
    // A revision that only cites what the old note already rested on is the
    // same understanding again. It must not set the old one down and start
    // the clock over.
    if (thought.kind === "revision" && parent) {
      const spent = new Set();
      let current = parent;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        spent.add(`t:${current.id}`);
        for (const source of evidenceRoots(this.db, current.sources || [], now))
          spent.add(source);
        current = current.parent_id
          ? this.mind.thoughts.get(current.parent_id)
          : null;
      }
      if (
        !evidenceRoots(this.db, sources, now).some(
          (source) => !spent.has(source),
        )
      )
        return null;
    }
    const recent = this.mind.thoughts.list({ limit: 20 });
    const repeated = recent.some((t) => similar(t.content, content));
    if (repeated && !reach) return null;
    if (
      reach &&
      recent.some(
        (t) =>
          t.outreach_session === reach.session &&
          ["planned", "sending", "uncertain"].includes(t.outreach_status) &&
          similar(t.outreach, reach.text),
      )
    )
      return null;
    // Anything grounded in a private room stays there, including a planned
    // sentence. A private message counts the same as a private meeting.
    if (reach) {
      if (
        !this.initiative.audience(
          {
            sources: [...sources, ...(parent ? [`t:${parent.id}`] : [])],
            created: now,
          },
          reach.session,
          now,
        ).allowed
      )
        reach = null;
    }
    if (!sources.length && !reach) return null;
    if (repeated && !reach) return null;
    const place = this.placeOf(sources);
    const quiet = new Set(this.mind.meetings.privateRoots(sources));
    const fits = (id) =>
      quiet.size
        ? quiet.has(id)
        : place.discretion === "private"
          ? isPrivateSession(id)
          : !isPrivateSession(id);
    const rooted = this.sourcePlaces(sources).filter(fits);
    const sessions = [
      ...new Set([
        ...(rooted.length ? rooted : involved.filter(fits)),
        ...(reach ? [reach.session] : []),
      ]),
    ];
    const added = this.mind.thoughts.add({
      kind: thought.kind,
      content:
        repeated && reach
          ? text(`想说：${reach.text}。${reach.reason || ""}`, 600)
          : content,
      sessions,
      sources,
      parentId: parent?.id || null,
      importance: clamp(thought.importance ?? 0.5),
      revisitHours: Math.min(720, Number(thought.revisitHours) || 0),
      outreach: reach ? text(reach.text, 120) : "",
      outreachSession: reach?.session || null,
      outreachAfterHours: reach
        ? Math.max(0, Number(reach.afterHours) || 0)
        : undefined,
      outreachReason: reach?.reason || "",
      runId: id,
      time: now,
    });
    // The old words stay as they were; only the old understanding is set down.
    if (thought.kind === "revision" && parent)
      this.mind.thoughts.resolve(parent.id, "有了新的理解", now);
    return added;
  }

  diaryDue(...args) {
    return this.journal.diaryDue(...args);
  }

  dayStart(...args) {
    return this.journal.dayStart(...args);
  }
  // A review can be rewritten into the story she carries everywhere, so a day
  // whose words stay private does not travel there as text.

  diaryLine(...args) {
    return this.journal.diaryLine(...args);
  }
  // The account she carries into later writing. Sentences that repeat a
  // private fact are left out; the rest can still be retold.

  openWords(...args) {
    return this.journal.openWords(...args);
  }

  openThreads(...args) {
    return this.journal.openThreads(...args);
  }
  // Where she is in her own story, kept short for the diary and solitude.
  // Writing that still names a duty as the life she is living is kept
  // as history; those sentences are not handed back as what she is living.

  chapterView(...args) {
    return this.journal.chapterView(...args);
  }
  // The wish she is living is not yet in this chapter.

  // Drop sentences that still call a duty the life she is living.

  async review(...args) {
    if (this.mind.time.attention.activityBusy)
      return { status: "skipped", reason: "自己的活动步骤尚未结束" };
    const primary = this.mind.time.primary();
    if (primary)
      this.mind.time.tasks.control(
        primary.id,
        {
          action: "pause",
          readyAt: this.now() + this.mind.time.settings().breakMinutes * 60000,
          reason: "安排调整：先写日记，保留续接位置",
        },
        this.now(),
      );
    return this.journal.review(...args);
  }
  // Latest version of each chapter: she can re-understand her own past.

  chapters(...args) {
    return this.journal.chapters(...args);
  }

  chapterVersions(...args) {
    return this.journal.chapterVersions(...args);
  }
  // Night: while she sleeps (in the small hours without a rhythm), one
  // quiet task at a time, after the diary.

  isNight(...args) {
    return this.journal.isNight(...args);
  }

  nightDue(...args) {
    return this.journal.nightDue(...args);
  }
  // Quiet chats do not wait for forty messages: what was said today is
  // sorted into memory tonight.

  async rememberAtNight(...args) {
    return this.journal.rememberAtNight(...args);
  }
  // Every so often (and first once there are two diaries) she looks back
  // over the stretch since the last review.

  reviewDue(...args) {
    return this.journal.reviewDue(...args);
  }

  async reviewPeriod(...args) {
    if (this.mind.time.attention.activityBusy)
      return { status: "skipped", reason: "自己的活动步骤尚未结束" };
    return this.journal.reviewPeriod(...args);
  }
  // continue rewrites the chapter she is in; close ends it and opens the next.

  turnChapter(...args) {
    return this.journal.turnChapter(...args);
  }

  diaries(...args) {
    return this.journal.diaries(...args);
  }
  // Whether to say something first is her own turn; these are only the
  // limits a considerate person keeps.
  // A room she was just in has gone quiet. She looks once and may say one
  // thing of her own; silence is still a complete answer.

  async considerPresence(...args) {
    return this.presence.considerPresence(...args);
  }

  presenceCooling(...args) {
    return this.presence.presenceCooling(...args);
  }

  markPresence(...args) {
    return this.presence.markPresence(...args);
  }

  wasHere(...args) {
    return this.presence.wasHere(...args);
  }

  async reachOut(...args) {
    return this.presence.reachOut(...args);
  }
  // People this planned sentence was about, who have shown up since she
  // wrote it. The sentence can still be said; the absence is no longer a fact.

  returnedSince(...args) {
    return this.presence.returnedSince(...args);
  }

  outreachBlocked(...args) {
    return this.presence.outreachBlocked(...args);
  }
}
