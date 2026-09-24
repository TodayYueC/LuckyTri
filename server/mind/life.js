import { randomUUID } from "node:crypto";
import { localClock } from "../core/conversation-cues.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { estimateTokens } from "../core/model-manager.js";
import { elapsedLabel } from "./clock.js";
import { rhythmPhase } from "./nature.js";
import { SELF_KINDS } from "./self.js";
import { THOUGHT_KINDS } from "./thoughts.js";
import {
  DAY,
  HOUR,
  clamp,
  dayKey,
  evidence,
  hasCredential,
  parse,
  similar,
  text,
} from "./util.js";

export const LIFE_DEFAULTS = {
  solitude: true,
  proactive: false,
  diary: true,
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

function minutesOf(clock) {
  const [h, m] = String(clock || "08:00")
    .split(":")
    .map(Number);
  return h * 60 + m;
}

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
    for (const key of ["solitude", "proactive", "diary"])
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
    if (typeof next.modelId !== "string") throw Error("模型无效");
    if (next.modelId) this.chat.models.profile(next.modelId);
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
    const rhythm = this.mind.nature.current(now).rhythm;
    const offset = rhythm?.enabled ? minutesOf(rhythm.wake) * MINUTE : 4 * HOUR;
    return dayKey(now - offset, this.mind.timeZone());
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
    const selected = this.chat.models.profile(
      this.settings().modelId || undefined,
    );
    return selected;
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
    const phase = this.phase(now).key;
    if (phase !== "asleep") {
      const woke = await this.wake(now);
      if (woke) return woke;
    }
    const due = this.diaryDue(now);
    if (due) return this.review(due);
    const outreach = await this.reachOut(now);
    if (outreach) return outreach;
    const reason = this.eligible(now);
    if (!reason) return this.reflect();
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
    if ((s.minMessages === 0 || fresh < s.minMessages) && !revisit && !feedback)
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
    return this.mind.self.active({ before: now, limit: 16 }).map((t) => ({
      thread: t.thread,
      kind: t.kind,
      content: t.content,
      strength: t.strength,
      ...(t.status === "emerging" ? { emerging: true } : {}),
    }));
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
      const input = {
        clock: localClock(now, this.mind.timeZone()),
        mood: (({ mood, cause, energyLabel, phaseLabel }) => ({
          mood,
          cause,
          energy: energyLabel,
          phase: phaseLabel,
        }))(this.mind.affect.state(now, { nature })),
        self: this.selfView(now),
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
      const changed = involved.some((session) =>
        this.repo
          .eventsAfter(session, watermark, { simulated: false })
          .some((m) => m.role === "user"),
      );
      if (this.closed || changed || this.mind.nature.version() !== version) {
        status = "cancelled";
        reason = "独处期间又有了新的对话，这次想法不作数";
      } else if (result?.skip === true && !result.mood) {
        status = "empty";
      } else {
        const valid = new Set([
          ...experiences.flatMap((e) => e.messages.map((m) => `m:${m.seq}`)),
          ...thoughts.map((t) => `t:${t.id}`),
          ...input.feedback.map((f) => f.ref),
        ]);
        const noted = this.writeThought(result?.thought, {
          valid,
          thoughts,
          involved,
          id,
          now,
          outreach: s.proactive ? result?.outreach : null,
        });
        const applied = result?.skip
          ? { self: 0, faces: 0, bonds: 0 }
          : this.grow(result, valid, "solitude", now);
        if (result?.mood?.feeling)
          this.mind.affect.feel({
            feeling: result.mood.feeling,
            intensity: clamp(result.mood.intensity ?? 0.25, 0, 0.6),
            valence: result.mood.valence,
            cause: noted ? text(result.thought?.content, 80) : "独处",
            origin: "solitude",
            time: now,
          });
        summary = { thought: noted, ...applied };
        status =
          noted || applied.self || applied.faces || applied.bonds
            ? "written"
            : result?.mood?.feeling
              ? "state"
              : "empty";
        reason =
          status === "written"
            ? "留下了新的理解"
            : status === "state"
              ? "没有新想法，但心情有了变化"
              : "没有新的理解";
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
  writeThought(thought, { valid, thoughts, involved, id, now, outreach }) {
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
      involved.includes(outreach.session) &&
      !/寂寞|孤独|不理我|好久没找我|怎么不回|一直等你/.test(outreach.text)
        ? outreach
        : null;
    return this.mind.thoughts.add({
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
    const rhythm = this.mind.nature.current(now).rhythm;
    const offset = rhythm?.enabled ? minutesOf(rhythm.wake) : 240;
    const clock = localClock(now, this.mind.timeZone());
    const minutes = clock.hour * 60 + Number(clock.local.slice(14, 16));
    const back = (minutes - offset + 1440) % 1440;
    return now - back * MINUTE - (now % MINUTE);
  }
  async review({ day, start, end }) {
    this.busy = true;
    const now = this.now();
    const s = this.settings();
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
      const chapters = this.chapters();
      const lastChapter = chapters.reduce((t, c) => Math.max(t, c.created), 0);
      const chapterDue = !chapters.length
        ? this.db
            .prepare("SELECT COUNT(*) n FROM mind_diary WHERE day<?")
            .get(day).n >= 1
        : now - lastChapter >= s.chapterDays * DAY;
      const input = {
        date: day,
        today: {
          moods,
          thoughts: thoughts.map((t) => ({
            id: t.id,
            content: text(t.content, 200),
          })),
          choices: Object.fromEntries(choices.map((c) => [c.choice, c.n])),
          feedback: this.feedbackSince(start),
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
        chapters: chapters.map((c) => ({
          number: c.chapter,
          title: c.title,
          summary: text(c.content, 160),
        })),
        chapterDue,
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
      let chapter = null;
      if (chapterDue && result.chapter && typeof result.chapter === "object") {
        const content = text(result.chapter.content, 2400);
        const title = text(result.chapter.title, 60);
        const number =
          Number.isInteger(result.chapter.number) && result.chapter.number > 0
            ? Math.min(result.chapter.number, chapters.length + 1)
            : chapters.length + 1;
        if (content && title && !hasCredential(content)) {
          this.db
            .prepare(
              "INSERT INTO mind_chapters(id,chapter,created,title,content,period_start,period_end,run_id) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              randomUUID(),
              number,
              now,
              title,
              content,
              chapters.find((c) => c.chapter === number)?.period_start ??
                (chapters.at(-1)?.period_end || start),
              end,
              id,
            );
          chapter = number;
        }
      }
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
      summary = { day, chapter, ...applied };
      status = "written";
      reason = chapter
        ? `写下了 ${day} 的日记，也重写了自传第 ${chapter} 章`
        : `写下了 ${day} 的日记`;
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
    return this.db
      .prepare(
        "SELECT c.* FROM mind_chapters c WHERE c.rowid=(SELECT rowid FROM mind_chapters d WHERE d.chapter=c.chapter ORDER BY created DESC, rowid DESC LIMIT 1) ORDER BY chapter",
      )
      .all();
  }
  chapterVersions(chapter) {
    return this.db
      .prepare(
        "SELECT * FROM mind_chapters WHERE chapter=? ORDER BY created DESC",
      )
      .all(chapter);
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
    const events = this.repo
      .eventsAfter(session, 0, { simulated: false })
      .slice(-20);
    const last = events.at(-1);
    if (!last) return "没有来往";
    if (now - last.time < 3 * HOUR) return "对话还没安静下来";
    const lastUser = events.filter((m) => m.role === "user").at(-1);
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
