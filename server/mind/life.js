import { randomUUID } from "node:crypto";
import { localClock } from "../core/conversation-cues.js";
import { isNameCall } from "../core/name-call.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { estimateTokens, withFallback } from "../core/model-manager.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { diffSnapshots } from "./index.js";
import { isPrivateSession } from "./memory.js";
import { lifeDayKey, lifeDayStart, rhythmPhase } from "./nature.js";
import { SELF_KINDS } from "./self.js";
import { THOUGHT_KINDS } from "./thoughts.js";
import {
  DAY,
  HOUR,
  clamp,
  evidence,
  hasCredential,
  messageSeqs,
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
  proactiveIntervalHours: 24,
  modelId: "",
  timeZone: "Asia/Shanghai",
};
const MINUTE = 60000;
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";
const SOLITUDE_INPUT_CAP = 24000;
// A chat with at least this many unsorted messages is sorted at night.
const NIGHT_PENDING = 6;

// Her days: waking up, being alone with her thoughts, writing the day down
// before sleep, and sometimes deciding to reach out first.
export class Life {
  constructor(chat, { now = chat.now || Date.now, online = () => false } = {}) {
    this.chat = chat;
    this.mind = chat.mind;
    this.repo = chat.repo;
    this.db = chat.repo.db;
    this.now = now;
    this.online = online;
    this.busy = false;
    this.closed = false;
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
      ["proactiveIntervalHours", 1, 8760],
    ])
      if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max)
        throw Error(`${key} 超出范围`);
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
  living() {
    return this.db
      .prepare(
        "SELECT id,name,kind FROM sessions WHERE enabled=1 AND archived=0",
      )
      .all()
      .filter(
        (s) =>
          this.chat.enabled(s.id, { simulated: false }) &&
          this.chat.policy(s.id).memory !== false,
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
    this.mind.days.rollup(now);
    const phase = this.phase(now).key;
    if (phase !== "asleep") {
      const woke = await this.wake(now);
      if (woke) return woke;
    }
    const due = this.diaryDue(now);
    if (due) return this.review(due);
    const night = this.nightDue(now);
    if (night)
      return night.kind === "memory"
        ? this.rememberAtNight(night.session, night.day, now)
        : this.reviewPeriod(now);
    const outreach = await this.reachOut(now);
    if (outreach) return outreach;
    const reason = this.eligible(now);
    if (!reason) return this.reflect();
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
        `SELECT MAX(time) t FROM core_events WHERE session_id IN (${marks}) AND ${LIVE}`,
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
        `SELECT COUNT(*) n FROM core_events WHERE session_id IN (${marks}) AND role='user' AND seq>? AND ${LIVE}`,
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
    if (
      (s.minMessages === 0 || fresh < s.minMessages) &&
      !revisit &&
      !feedback &&
      !shelf &&
      !ahead
    )
      return fresh ? "新经历还不多" : "没有新的经历";
    return null;
  }
  experiences(since, now, { limit = 5, rows = 24 } = {}) {
    const names = new Map(this.living().map((s) => [s.id, s]));
    const active = this.db
      .prepare(
        `SELECT session_id, MAX(time) t, COUNT(*) n FROM core_events WHERE seq>? AND time<=? AND ${LIVE} GROUP BY session_id ORDER BY t DESC`,
      )
      .all(since, now)
      .filter((r) => names.has(r.session_id))
      .slice(0, limit);
    return active.map((r) => {
      const events = this.repo
        .eventsAfter(r.session_id, since, { simulated: false })
        .filter((m) => m.time <= now);
      const stage = this.db
        .prepare(
          "SELECT data FROM core_stages WHERE session_id=? ORDER BY last_seq DESC LIMIT 1",
        )
        .get(r.session_id);
      const selfName = this.mind.nature.current(now).name;
      return {
        session: r.session_id,
        name: names.get(r.session_id).name,
        kind: names.get(r.session_id).kind,
        lastActive: elapsedLabel(r.t, now, this.mind.timeZone()),
        ...(stage ? { earlier: text(parse(stage.data, {}).summary, 400) } : {}),
        messages: events.slice(-rows).map((m) => ({
          seq: m.seq,
          name: m.role === "assistant" ? selfName : m.name,
          ...(m.role === "assistant" ? { self: true } : { userId: m.userId }),
          time: localClock(m.time, this.mind.timeZone()).local.slice(5),
          text: text(m.text, 160),
        })),
      };
    });
  }
  feedbackSince(since) {
    const labels = {
      too_long: "太长了",
      too_formal: "太端着",
      too_meme: "梗太多",
      natural: "挺自然",
    };
    return this.db
      .prepare(
        "SELECT f.decision_id id,f.tag,d.reply,d.session_id FROM reply_feedback f JOIN decisions d ON d.id=f.decision_id WHERE f.time>? AND d.is_demo=0 ORDER BY f.time DESC LIMIT 6",
      )
      .all(since)
      .map((r) => ({
        ref: `f:${r.id}`,
        session: r.session_id,
        said: text(r.reply, 60),
        felt: labels[r.tag] || r.tag,
      }));
  }
  selfView(now) {
    return this.mind.self.active({ before: now, now, limit: 16 }).map((t) => ({
      thread: t.thread,
      kind: t.kind,
      content: t.content,
      strength: t.strength,
      ...(t.status === "emerging" ? { emerging: true } : {}),
    }));
  }
  // Threads slipping out of view: she may let them go or, with something
  // new behind it, hold on.
  fadingView(now) {
    return this.mind.self.fading({ before: now, now, limit: 3 }).map((t) => ({
      thread: t.thread,
      kind: t.kind,
      content: t.content,
      lastTouched: elapsedLabel(t.created, now, this.mind.timeZone()),
    }));
  }
  // People she has grown close to and not heard from in a while. Their last
  // message is what she can point at when she thinks of them.
  missingView(now) {
    const living = new Set(this.living().map((s) => s.id));
    const lastSaid = this.db.prepare(
      "SELECT sources FROM mind_bond_events WHERE subject_kind='person' AND subject_id=? AND created<=? AND sources!='[]' ORDER BY created DESC LIMIT 1",
    );
    const event = this.db.prepare(
      "SELECT seq,session_id,payload FROM core_events WHERE seq=?",
    );
    return this.mind.bonds.missing({ now, limit: 3 }).map((p) => {
      const seq = evidence(parse(lastSaid.get(p.userId, now)?.sources, []))
        .filter((s) => s.startsWith("m:"))
        .map((s) => Number(s.slice(2)))
        .at(-1);
      const row = seq ? event.get(seq) : null;
      const said = row ? parse(row.payload, {}) : null;
      return {
        userId: p.userId,
        name: p.name,
        feel: p.feel,
        lastSeen: agoLabel(now - p.seenAt),
        ...(p.impression ? { impression: p.impression } : {}),
        sessions: p.sessions.filter((s) => living.has(s)),
        ...(row ? { ref: `m:${row.seq}` } : {}),
        // What was said in a private chat stays out of her solitary notes.
        ...(said && !isPrivateSession(row.session_id)
          ? { lastSaid: text(said.text, 80) }
          : {}),
      };
    });
  }
  // Where a thought came from decides where a plan built on it may surface:
  // anything rooted in a private chat stays there.
  placeOf(sources) {
    const refs = evidence(sources);
    const seqs = messageSeqs(refs);
    const sessions = seqs.length
      ? this.db
          .prepare(
            `SELECT DISTINCT session_id FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
          )
          .all(...seqs)
          .map((r) => r.session_id)
      : [];
    for (const ref of refs.filter((r) => r.startsWith("t:")))
      sessions.push(...(this.mind.thoughts.get(ref.slice(2))?.sessions || []));
    const hidden = sessions.find((s) => isPrivateSession(s));
    if (hidden) return { session: hidden, discretion: "private" };
    const places = [...new Set(sessions)];
    return {
      session: places.length === 1 ? places[0] : null,
      discretion: "open",
    };
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
        content: plan?.content,
        due: plan?.due,
        sources,
        origin,
        time: now,
        ...this.placeOf(sources),
      });
      if (added.id) applied.plans++;
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
  peopleIn(experiences, now) {
    const ids = [
      ...new Set(
        experiences.flatMap((e) =>
          e.messages.map((m) => m.userId).filter(Boolean),
        ),
      ),
    ].slice(0, 8);
    return ids
      .map((id) => this.mind.bonds.person(id, now))
      .filter(Boolean)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        feel: p.feel,
        ...(p.impression ? { impression: p.impression } : {}),
      }));
  }
  // Applies what she concluded about herself, her faces and people. Every
  // change must cite something she actually lived through.
  grow(result, valid, origin, now) {
    const applied = { self: 0, faces: 0, bonds: 0 };
    for (const item of (Array.isArray(result.self) ? result.self : []).slice(
      0,
      6,
    ))
      if (this.mind.self.propose(item, { valid, origin, time: now })?.id)
        applied.self++;
    for (const item of (Array.isArray(result.faces) ? result.faces : []).slice(
      0,
      4,
    ))
      if (this.mind.faces.propose(item, { valid, origin, time: now })?.id)
        applied.faces++;
    for (const b of (Array.isArray(result.bonds) ? result.bonds : []).slice(
      0,
      6,
    )) {
      const cited = evidence(b?.evidence).filter((s) => valid.has(s));
      if (!b?.userId || !cited.length || b.change === "interaction") continue;
      if (
        this.mind.bonds.record({
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
  async reflect() {
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
    try {
      const nature = this.mind.nature.current(now);
      const version = nature.version;
      const experiences = this.experiences(since, now);
      const thoughts = this.mind.thoughts.open({ now, limit: 10 });
      const chunk = s.reading ? this.mind.reading.next(now) : null;
      const chapter = this.chapterView(now);
      const input = {
        ...(chunk ? { reading: this.mind.reading.passage(chunk) } : {}),
        clock: localClock(now, this.mind.timeZone()),
        ...(chapter ? { chapter } : {}),
        mood: (({ mood, cause, energyLabel, phaseLabel }) => ({
          mood,
          cause,
          energy: energyLabel,
          phase: phaseLabel,
        }))(this.mind.affect.state(now, { nature })),
        self: this.selfView(now),
        fading: this.fadingView(now),
        faces: experiences
          .map((e) => this.mind.faces.current(e.session, now))
          .filter(Boolean)
          .map((f) => ({
            session: f.session_id,
            role: f.role,
            tone: f.tone,
            aspiration: f.aspiration,
          })),
        people: this.peopleIn(experiences, now),
        missing: this.missingView(now),
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
      };
      if (!input.missing.length) delete input.missing;
      if (!input.fading.length) delete input.fading;
      if (!input.ahead.length) delete input.ahead;
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.experiences.some((e) => e.messages.length > 4)
      )
        for (const e of input.experiences)
          if (e.messages.length > 4) e.messages.shift();
      const result = await this.chat.models.call(
        this.profile(),
        "reflection",
        replyPrompt(nature, prompts(this.repo), "reflection"),
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
      } else if (result?.skip === true && !result.mood) {
        if (chunk)
          this.mind.reading.record(chunk, result?.readingNote || "", id, now);
        status = chunk ? "written" : "empty";
        reason = chunk ? `读了《${chunk.title}》，没多想` : reason;
        if (chunk) summary = { read: chunk.title };
      } else {
        const missing = input.missing || [];
        const ahead = input.ahead || [];
        const valid = new Set([
          ...experiences.flatMap((e) => e.messages.map((m) => `m:${m.seq}`)),
          ...thoughts.map((t) => `t:${t.id}`),
          ...input.feedback.map((f) => f.ref),
          ...(chunk ? [`r:${chunk.id}`] : []),
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
          ]),
          id,
          now,
          outreach:
            s.proactive && !stirred.has(result?.outreach?.session)
              ? result?.outreach
              : null,
        });
        const applied = result?.skip
          ? { self: 0, faces: 0, bonds: 0 }
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
          ...applied,
          ...(chunk ? { read: chunk.title } : {}),
          ...(stirred.size ? { interrupted: [...stirred] } : {}),
        };
        status =
          noted ||
          applied.self ||
          applied.faces ||
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
      this.end(id, status, reason, trace, summary);
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
    if (!thought || typeof thought !== "object") return null;
    const content = text(thought.content, 600);
    if (!content || hasCredential(content)) return null;
    const cited = evidence(thought.sources);
    const sources = cited.filter((x) => valid.has(x));
    if (!sources.length) return null;
    const parent = thought.parentId
      ? thoughts.find((t) => t.id === thought.parentId) ||
        this.mind.thoughts.get(thought.parentId)
      : null;
    if (thought.parentId && !parent) return null;
    if (thought.kind === "revision" && !parent) return null;
    const recent = this.mind.thoughts.list({ limit: 20 });
    if (recent.some((t) => similar(t.content, content))) return null;
    const reach =
      outreach &&
      typeof outreach.text === "string" &&
      outreach.text.trim() &&
      reachable.has(outreach.session) &&
      !/寂寞|孤独|不理我|好久没找我|怎么不回|一直等你/.test(outreach.text)
        ? outreach
        : null;
    const added = this.mind.thoughts.add({
      kind: thought.kind,
      content,
      sessions: involved,
      sources,
      parentId: parent?.id || null,
      importance: clamp(thought.importance ?? 0.5),
      revisitHours: reach
        ? Math.max(1, Number(reach.afterHours) || 6)
        : Math.min(720, Number(thought.revisitHours) || 0),
      outreach: reach ? text(reach.text, 120) : "",
      outreachSession: reach?.session || null,
      runId: id,
      time: now,
    });
    // The old words stay as they were; only the old understanding is set down.
    if (thought.kind === "revision" && parent)
      this.mind.thoughts.resolve(parent.id, "有了新的理解", now);
    return added;
  }
  diaryDue(now = this.now()) {
    const s = this.settings();
    if (!s.diary) return null;
    try {
      this.profile();
    } catch {
      return null;
    }
    if (!this.mind.budget.allows("inner", now)) return null;
    const phase = this.phase(now).key;
    const nature = this.mind.nature.current(now);
    const bedtime = nature.rhythm?.enabled
      ? ["sleepy", "asleep"].includes(phase)
      : localClock(now, this.mind.timeZone()).hour >= 23;
    const day = this.lifeDay(now);
    // A diary that failed to come out waits a while, and a day is given up
    // after a few tries rather than retried every minute.
    const has = (d) => {
      if (
        this.db.prepare("SELECT 1 FROM mind_diary WHERE day=? LIMIT 1").get(d)
      )
        return true;
      const tries = this.db
        .prepare(
          "SELECT COUNT(*) n, MAX(started) last FROM mind_runs WHERE kind='daily' AND json_extract(summary,'$.day')=?",
        )
        .get(d);
      return tries.n >= 3 || (tries.last && now - tries.last < 3 * HOUR);
    };
    const lived = (start, end) =>
      this.db
        .prepare(
          `SELECT COUNT(*) n FROM core_events WHERE time>? AND time<=? AND ${LIVE}`,
        )
        .get(start, end).n >= 3;
    const start = this.dayStart(now);
    if (bedtime && !has(day) && lived(start, now))
      return { day, start, end: now };
    const yesterday = this.lifeDay(start - MINUTE);
    const before = this.dayStart(start - MINUTE);
    if (!bedtime && !has(yesterday) && lived(before, start))
      return { day: yesterday, start: before, end: start };
    return null;
  }
  dayStart(now) {
    return lifeDayStart(
      this.mind.nature.current(now),
      now,
      this.mind.timeZone(),
    );
  }
  // Where she is in her own story, kept short for the diary and solitude.
  chapterView(now, size = 120) {
    const chapter = this.mind.periods.current(now);
    return chapter
      ? {
          number: chapter.chapter,
          title: chapter.title,
          gist: text(chapter.content, size),
        }
      : null;
  }
  async review({ day, start, end }) {
    this.busy = true;
    const now = this.now();
    const id = this.run("daily", `写 ${day} 的日记`);
    const trace = this.repo.trace("__mind__", "daily");
    let status = "empty";
    let reason = "今天没有写下什么";
    let summary = { day };
    try {
      const nature = this.mind.nature.current(now);
      const since =
        this.db
          .prepare(
            `SELECT COALESCE(MIN(seq),1)-1 n FROM core_events WHERE time>? AND ${LIVE}`,
          )
          .get(start).n || 0;
      const experiences = this.experiences(since, end, { limit: 6, rows: 14 });
      const thoughts = this.db
        .prepare(
          "SELECT * FROM mind_thoughts WHERE created>? AND created<=? AND hidden=0 ORDER BY created LIMIT 10",
        )
        .all(start, end);
      const choices = this.db
        .prepare(
          "SELECT choice,COUNT(*) n FROM mind_choices WHERE created>? AND created<=? GROUP BY choice",
        )
        .all(start, end);
      const moods = this.mind.affect
        .history({ before: end, limit: 40 })
        .filter((a) => a.created > start)
        .slice(0, 12)
        .map((a) => ({
          at: localClock(a.created, this.mind.timeZone()).local.slice(11),
          feeling: a.feeling,
          cause: text(a.cause, 50),
        }));
      const previousDay = this.db
        .prepare(
          "SELECT day FROM mind_snapshots WHERE day<? ORDER BY day DESC LIMIT 1",
        )
        .get(day)?.day;
      const yesterday = previousDay ? this.mind.snapshotOf(previousDay) : null;
      const lastDiary = this.db
        .prepare(
          "SELECT day,content,compare FROM mind_diary WHERE day<? ORDER BY day DESC, created DESC LIMIT 1",
        )
        .get(day);
      // Only the short account of her life and the chapter she is in, so
      // the diary does not grow with her age.
      const story = this.mind.periods.story(now);
      const chapter = this.chapterView(now);
      const anniversaries = this.mind.days.anniversaries(end);
      const expected = this.mind.anticipations.today({ start, end });
      const open = this.mind.anticipations.due({ now: end, limit: 5 });
      const ahead = Object.fromEntries(
        Object.entries({ ...expected, open }).filter(([, v]) => v.length),
      );
      const input = {
        date: day,
        dayOfLife: this.mind.days.dayOfLife(end),
        today: {
          moods,
          thoughts: thoughts.map((t) => ({
            id: t.id,
            content: text(t.content, 200),
          })),
          choices: Object.fromEntries(choices.map((c) => [c.choice, c.n])),
          feedback: this.feedbackSince(start),
          ...(Object.keys(ahead).length ? { ahead } : {}),
          experiences,
        },
        yesterday: yesterday
          ? {
              day: yesterday.day,
              mood: yesterday.affect?.mood,
              self: (yesterday.self || [])
                .slice(0, 12)
                .map(
                  (t) =>
                    `${SELF_KINDS[t.kind] || t.kind}：${t.content}（${t.strength}）`,
                ),
              ...(lastDiary ? { diary: text(lastDiary.content, 240) } : {}),
            }
          : null,
        self: this.selfView(now),
        people: this.peopleIn(experiences, now),
        ...(story ? { story: text(story.content, 600) } : {}),
        ...(chapter ? { chapter } : {}),
        ...(anniversaries.length ? { anniversaries } : {}),
      };
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.today.experiences.some((e) => e.messages.length > 3)
      )
        for (const e of input.today.experiences)
          if (e.messages.length > 3) e.messages.shift();
      const result = await this.chat.models.call(
        this.profile(),
        "daily",
        replyPrompt(nature, prompts(this.repo), "daily"),
        input,
        trace,
      );
      const diary = text(result?.diary, 1200);
      if (!diary || hasCredential(diary)) throw SyntaxError("日记格式无效");
      const valid = new Set([
        ...experiences.flatMap((e) => e.messages.map((m) => `m:${m.seq}`)),
        ...thoughts.map((t) => `t:${t.id}`),
        ...input.today.feedback.map((f) => f.ref),
        ...open.map((a) => a.ref),
      ]);
      this.db
        .prepare(
          "INSERT INTO mind_diary(id,day,created,content,mood,compare,sources,run_id) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          day,
          now,
          diary,
          text(result.mood, 16),
          text(result.compare, 300),
          JSON.stringify([...valid].slice(0, 24)),
          id,
        );
      const applied = this.grow(result, valid, "daily", now);
      applied.letGo = this.letGo(
        result?.letGo,
        new Set(thoughts.map((t) => t.id)),
        now,
      );
      Object.assign(
        applied,
        this.anticipate(result, {
          valid,
          shown: new Set(open.map((a) => a.ref.slice(2))),
          origin: "daily",
          now,
        }),
      );
      if (result.mood)
        this.mind.affect.feel({
          feeling: result.mood,
          intensity: 0.2,
          valence: 0,
          cause: "写完了今天的日记",
          origin: "daily",
          time: now,
        });
      this.mind.snapshot(now, day);
      summary = { day, ...applied };
      status = "written";
      reason = `写下了 ${day} 的日记`;
    } catch (error) {
      status = "error";
      reason =
        error instanceof SyntaxError
          ? "日记格式无效，未保存"
          : String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      trace.reason = reason;
      this.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      this.end(id, status, reason, trace, summary);
      this.busy = false;
    }
    return { status, reason, runId: id };
  }
  // Latest version of each chapter: she can re-understand her own past.
  chapters() {
    return this.mind.periods.chapters();
  }
  chapterVersions(chapter) {
    return this.mind.periods.chapterVersions(chapter);
  }
  // Night: while she sleeps (in the small hours without a rhythm), one
  // quiet task at a time, after the diary.
  isNight(now = this.now()) {
    if (this.mind.nature.current(now).rhythm?.enabled)
      return this.phase(now).key === "asleep";
    const hour = localClock(now, this.mind.timeZone()).hour;
    return hour >= 3 && hour < 6;
  }
  nightDue(now = this.now()) {
    if (!this.settings().night || !this.isNight(now)) return null;
    try {
      this.profile();
    } catch {
      return null;
    }
    const day = this.lifeDay(now);
    if (
      this.mind.budget.allows("upkeep", now) &&
      this.repo.store.settings().memoryEnabled !== false
    ) {
      const done = this.db.prepare(
        "SELECT 1 FROM mind_runs WHERE kind='night' AND json_extract(summary,'$.day')=? AND json_extract(summary,'$.session')=? LIMIT 1",
      );
      for (const { id } of this.living())
        if (
          !this.mind.memory.busy.has(id) &&
          this.mind.memory.pending(id) >= NIGHT_PENDING &&
          !done.get(day, id)
        )
          return { kind: "memory", session: id, day };
    }
    if (this.reviewDue(now)) return { kind: "review" };
    return null;
  }
  // Quiet chats do not wait for forty messages: what was said today is
  // sorted into memory tonight.
  async rememberAtNight(session, day, now = this.now()) {
    this.busy = true;
    const name = this.living().find((s) => s.id === session)?.name || session;
    const id = this.run("night", `夜里整理「${name}」里的事`);
    const trace = this.repo.trace(session, "memory");
    let status = "empty";
    let reason = "没有需要整理的";
    try {
      const profile = this.profile();
      const models = withFallback(
        this.chat.models,
        this.chat.fallbackFor(null, profile, trace),
      );
      const before = this.mind.memory.pending(session);
      await this.mind.memory.consolidate(
        session,
        profile,
        prompts(this.repo).memory,
        trace,
        { force: true, models, now },
      );
      const left = this.mind.memory.pending(session);
      if (left < before) {
        status = "written";
        reason = `夜里整理了「${name}」的 ${before - left} 条消息`;
      }
    } catch (error) {
      status = "error";
      reason = String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      trace.reason = reason;
      this.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      this.end(id, status, reason, trace, { day, session });
      this.busy = false;
    }
    return { status, reason, runId: id };
  }
  // Every so often (and first once there are two diaries) she looks back
  // over the stretch since the last review.
  reviewDue(now = this.now()) {
    const s = this.settings();
    if (!s.diary || !this.mind.budget.allows("inner", now)) return false;
    const last = this.mind.periods.lastReview(now);
    const written = this.db
      .prepare(
        "SELECT COUNT(DISTINCT day) n FROM mind_diary WHERE created>? AND created<=?",
      )
      .get(last?.created ?? 0, now).n;
    if (written < 2) return false;
    if (last && now - last.created < s.chapterDays * DAY - 6 * HOUR)
      return false;
    const tries = this.db
      .prepare(
        "SELECT COUNT(*) n, MAX(started) last FROM mind_runs WHERE kind='weekly' AND status='error' AND started>=?",
      )
      .get(this.dayStart(now));
    return !(tries.n >= 3 || (tries.last && now - tries.last < 3 * HOUR));
  }
  async reviewPeriod(now = this.now()) {
    this.busy = true;
    const id = this.run("weekly", "回顾这一段日子");
    const trace = this.repo.trace("__mind__", "weekly");
    let status = "empty";
    let reason = "这次没有写下回顾";
    let summary = null;
    try {
      const nature = this.mind.nature.current(now);
      const periods = this.mind.periods;
      const last = periods.lastReview(now);
      const start =
        last?.period_end ??
        this.mind.days.born() ??
        now - this.settings().chapterDays * DAY;
      const diaries = [
        ...new Map(
          this.db
            .prepare(
              "SELECT * FROM mind_diary WHERE created>? AND created<=? ORDER BY day, created",
            )
            .all(last?.created ?? 0, now)
            .map((d) => [d.day, d]),
        ).values(),
      ].slice(-10);
      const first = diaries[0]?.day;
      const earlier = first
        ? this.db
            .prepare(
              "SELECT day FROM mind_snapshots WHERE day<? ORDER BY day DESC LIMIT 1",
            )
            .get(first)?.day
        : null;
      const latest = this.db
        .prepare(
          "SELECT day FROM mind_snapshots WHERE created<=? ORDER BY day DESC LIMIT 1",
        )
        .get(now)?.day;
      const change =
        earlier && latest
          ? diffSnapshots(
              this.mind.snapshotOf(earlier),
              this.mind.snapshotOf(latest),
            )
          : null;
      const chapter = periods.current(now);
      const previous = chapter
        ? periods.chapters(now).find((c) => c.chapter === chapter.chapter - 1)
        : null;
      const story = periods.story(now);
      const { kept, missed } = this.mind.anticipations.today({
        start,
        end: now,
      });
      const anniversaries = this.mind.days.anniversaries(now);
      const line = (t) =>
        `${SELF_KINDS[t.kind] || t.kind}：${text(t.content, 60)}`;
      const input = {
        dayOfLife: this.mind.days.dayOfLife(now),
        period: { from: first, to: diaries.at(-1)?.day },
        diaries: diaries.map((d) => ({
          ref: `d:${d.day}`,
          day: d.day,
          ...(d.mood ? { mood: d.mood } : {}),
          content: text(d.content, 400),
          ...(d.compare ? { compare: text(d.compare, 120) } : {}),
        })),
        ...(last
          ? {
              lastReview: {
                content: text(last.content, 300),
                ...(last.compare ? { compare: text(last.compare, 120) } : {}),
              },
            }
          : {}),
        ...(change
          ? {
              changes: {
                appeared: change.appeared.slice(0, 6).map(line),
                faded: change.faded.slice(0, 6).map(line),
                changed: change.changed
                  .slice(0, 6)
                  .map(
                    (t) =>
                      `${text(t.before.content, 40)} → ${text(t.content, 40)}`,
                  ),
                people: change.people
                  .sort(
                    (a, b) => Math.abs(b.shift ?? 1) - Math.abs(a.shift ?? 1),
                  )
                  .slice(0, 5)
                  .map(
                    (p) =>
                      `${p.name}：${p.shift === null ? "新认识的" : p.shift > 0 ? "更近了" : "远了一些"}`,
                  ),
              },
            }
          : {}),
        ...(kept.length || missed.length
          ? { ahead: { kept: kept.slice(0, 5), missed: missed.slice(0, 5) } }
          : {}),
        ...(chapter
          ? {
              chapter: {
                number: chapter.chapter,
                title: chapter.title,
                content: text(chapter.content, 800),
                reviews: periods.reviewsSince(
                  periods.began(chapter.chapter),
                  now,
                ),
              },
            }
          : {}),
        ...(previous
          ? {
              previousChapter: {
                number: previous.chapter,
                title: previous.title,
                summary: text(previous.content, 160),
              },
            }
          : {}),
        ...(story ? { story: text(story.content, 600) } : {}),
        ...(anniversaries.length ? { anniversaries } : {}),
        self: this.selfView(now).slice(0, 10),
      };
      const result = await this.chat.models.call(
        this.profile(),
        "weekly",
        replyPrompt(nature, prompts(this.repo), "weekly"),
        input,
        trace,
      );
      const week = text(result?.week, 1500);
      if (!week || hasCredential(week)) throw SyntaxError("回顾格式无效");
      const valid = new Set(diaries.map((d) => `d:${d.day}`));
      periods.write("week", {
        start,
        end: now,
        content: week,
        compare: result?.compare,
        sources: [...valid],
        runId: id,
        time: now,
      });
      const applied = this.grow(
        { self: result.self, bonds: result.bonds },
        valid,
        "weekly",
        now,
      );
      const turned = this.turnChapter(result?.chapter, {
        chapter,
        start,
        now,
        runId: id,
      });
      const told = text(result?.story, 1800);
      const retold =
        !!told && !hasCredential(told) && (turned.opened || !story);
      if (retold)
        periods.write("story", {
          content: told,
          sources: [...valid],
          runId: id,
          time: now,
        });
      summary = { chapter: turned.number, story: retold, ...applied };
      status = "written";
      reason =
        turned.opened && chapter
          ? `回顾了这段日子，翻开了第 ${turned.number} 章`
          : turned.number
            ? `回顾了这段日子，写下了第 ${turned.number} 章`
            : "回顾了这段日子";
    } catch (error) {
      status = "error";
      reason =
        error instanceof SyntaxError
          ? "回顾格式无效，未保存"
          : String(error.message).slice(0, 300);
      trace.error = error.message;
    } finally {
      trace.reason = reason;
      this.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      this.end(id, status, reason, trace, summary);
      this.busy = false;
    }
    return { status, reason, runId: id };
  }
  // continue rewrites the chapter she is in; close ends it and opens the next.
  turnChapter(value, { chapter, start, now, runId }) {
    const none = { number: null, opened: false };
    if (!value || typeof value !== "object") return none;
    if (!["continue", "close"].includes(value.action)) return none;
    const title = text(value.title, 60);
    const content = text(value.content, 2400);
    if (!title || !content || hasCredential(content)) return none;
    const periods = this.mind.periods;
    if (!chapter)
      return {
        number: periods.writeChapter({
          number: 1,
          title,
          content,
          start: this.mind.days.born() ?? start,
          end: now,
          runId,
          time: now,
        }),
        opened: true,
      };
    if (value.action === "continue")
      return {
        number: periods.writeChapter({
          number: chapter.chapter,
          title,
          content,
          start: periods.began(chapter.chapter) ?? chapter.period_start,
          end: now,
          runId,
          time: now,
        }),
        opened: false,
      };
    return {
      number: periods.writeChapter({
        number: chapter.chapter + 1,
        title,
        content,
        start: now,
        end: now,
        runId,
        time: now,
      }),
      opened: true,
    };
  }
  diaries({ before = "9999-12-31", limit = 14 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_diary WHERE day<=? ORDER BY day DESC, created DESC LIMIT ?",
      )
      .all(before, limit)
      .map((d) => ({ ...d, sources: parse(d.sources, []) }));
  }
  // Whether to say something first is her own turn; these are only the
  // limits a considerate person keeps.
  // A room she was just in has gone quiet. She looks once and may say one
  // thing of her own; silence is still a complete answer.
  async considerPresence(now = this.now()) {
    const s = this.settings();
    if (!s.proactive || !this.online()) return null;
    if (this.phase(now).key !== "awake") return null;
    const quietFor = Math.max(s.idleMinutes, 1) * MINUTE;
    const names = [
      this.mind.nature.current(now).name,
      ...String(this.repo.store.settings().aliases || "").split(/[,，]/),
    ];
    for (const session of this.living()) {
      const id = session.id;
      if (this.presenceCooling(id, now, s)) continue;
      if (this.outreachPending(id)) continue;
      const last = this.repo.recentEvents(id, 1, { simulated: false }).at(-1);
      if (!last || now - last.time < quietFor) continue;
      if (!this.wasHere(id, now, names)) continue;
      this.busy = true;
      let trace = null;
      try {
        trace = await this.chat.initiate(id, {
          type: "presence",
          data: { quietMinutes: Math.round((now - last.time) / MINUTE) },
        });
      } catch {
        this.markPresence(id, now);
        return {
          status: "presence-error",
          reason: "主动开口没有完成",
          session: id,
        };
      } finally {
        this.busy = false;
      }
      if (!trace) continue;
      this.markPresence(id, now);
      return {
        status: `presence-${trace.status || "done"}`,
        reason: trace.reason || "看了看要不要说",
        session: id,
      };
    }
    return null;
  }
  presenceCooling(session, now, s) {
    const tried = this.repo.config("presence", {});
    return !!(
      tried[session] && now - tried[session] < s.proactiveIntervalHours * HOUR
    );
  }
  markPresence(session, now) {
    const tried = { ...this.repo.config("presence", {}), [session]: now };
    this.repo.saveConfig("presence", tried);
  }
  outreachPending(session) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM mind_thoughts WHERE outreach_status='planned' AND hidden=0 AND status='open' AND outreach_session=? LIMIT 1",
      )
      .get(session);
  }
  wasHere(session, now, names) {
    const since = now - 12 * HOUR;
    return this.repo
      .recentEvents(session, 80, { simulated: false })
      .some((m) => {
        if (m.time < since) return false;
        if (m.role === "assistant") return true;
        const mentions = (m.mentions || []).map(String);
        if (m.accountId && mentions.includes(String(m.accountId))) return true;
        if (String(m.text || "").includes("@我")) return true;
        return isNameCall(m.text, names);
      });
  }
  async reachOut(now = this.now()) {
    const s = this.settings();
    if (!s.proactive || !this.online()) return null;
    if (this.phase(now).key !== "awake") return null;
    for (const t of this.mind.thoughts.dueOutreach(now)) {
      const session = t.outreach_session;
      const block = this.outreachBlocked(session, now, s);
      if (block) {
        this.mind.thoughts.setOutreach(t.id, "skipped");
        continue;
      }
      this.mind.thoughts.setOutreach(t.id, "sending");
      this.busy = true;
      try {
        const trace = await this.chat.initiate(session, {
          type: "outreach",
          data: { thought: t.content, planned: t.outreach },
        });
        const uncertain =
          trace &&
          this.db
            .prepare(
              "SELECT 1 FROM core_outbox WHERE trace_id=? AND status='uncertain'",
            )
            .get(trace.id);
        const status = uncertain
          ? "uncertain"
          : trace?.status === "sent"
            ? "sent"
            : trace?.status === "silent"
              ? "declined"
              : "cancelled";
        this.mind.thoughts.setOutreach(t.id, status);
        return {
          status: `outreach-${status}`,
          reason: trace?.reason || "没能联系",
          session,
        };
      } catch {
        this.mind.thoughts.setOutreach(t.id, "uncertain");
        return {
          status: "outreach-uncertain",
          reason: "主动联系的投递不确定，不再重试",
        };
      } finally {
        this.busy = false;
      }
    }
    return null;
  }
  outreachBlocked(session, now, s) {
    if (!session || !this.chat.enabled(session, { simulated: false }))
      return "会话不可用";
    const last = this.repo
      .recentEvents(session, 1, { simulated: false })
      .at(-1);
    if (!last) return "没有来往";
    if (now - last.time < 3 * HOUR) return "对话还没安静下来";
    const lastUser = this.repo
      .recentEvents(session, 1, { simulated: false, role: "user" })
      .at(-1);
    if (
      /别.*(?:找|发|联系)|不要.*(?:找|联系)|不用回|别回/.test(
        lastUser?.text || "",
      )
    )
      return "对方说过不想被打扰";
    const sentByLife = this.db
      .prepare(
        "SELECT MAX(o.time) t FROM core_outbox o JOIN core_traces tr ON tr.id=o.trace_id WHERE o.session_id=? AND o.status IN ('sending','confirmed','uncertain') AND json_extract(tr.data,'$.path')='outreach'",
      )
      .get(session).t;
    if (sentByLife && now - sentByLife < s.proactiveIntervalHours * HOUR)
      return "刚主动联系过";
    // An unanswered outreach is never followed by another one.
    if (sentByLife && (!lastUser || lastUser.time < sentByLife))
      return "上次主动说的话还没有回应";
    return null;
  }
}
