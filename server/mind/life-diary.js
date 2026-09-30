import { randomUUID } from "node:crypto";
import { localClock } from "../core/conversation-cues.js";
import { replyPrompt, prompts } from "../core/persona-manager.js";
import { estimateTokens, withFallback } from "../core/model-manager.js";
import { diffSnapshots } from "./index.js";
import { lifeDayStart } from "./nature.js";
import { SELF_KINDS } from "./self.js";
import { aboutLife, ownLife } from "./salience.js";
import { DAY, HOUR, hasCredential, parse, text } from "./util.js";
const MINUTE = 60000;
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";
const SOLITUDE_INPUT_CAP = 24000;
const NIGHT_PENDING = 6;

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class LifeDiary {
  constructor(owner) {
    this.owner = owner;
  }
  diaryDue(now = this.owner.now()) {
    const s = this.owner.settings();
    if (!s.diary) return null;
    try {
      this.owner.profile();
    } catch {
      return null;
    }
    if (!this.owner.mind.budget.allows("inner", now)) return null;
    const phase = this.owner.phase(now).key;
    const nature = this.owner.mind.nature.current(now);
    const bedtime = nature.rhythm?.enabled
      ? ["sleepy", "asleep"].includes(phase)
      : localClock(now, this.owner.mind.timeZone()).hour >= 23;
    const day = this.owner.lifeDay(now);
    // A diary that failed to come out waits a while, and a day is given up
    // after a few tries rather than retried every minute.
    const has = (d) => {
      if (
        this.owner.db
          .prepare("SELECT 1 FROM mind_diary WHERE day=? LIMIT 1")
          .get(d)
      )
        return true;
      const tries = this.owner.db
        .prepare(
          "SELECT COUNT(*) n, MAX(started) last FROM mind_runs WHERE kind='daily' AND json_extract(summary,'$.day')=?",
        )
        .get(d);
      return tries.n >= 3 || (tries.last && now - tries.last < 3 * HOUR);
    };
    const start = this.owner.dayStart(now);
    if (
      bedtime &&
      !has(day) &&
      this.owner.mind.days.participated(start, now, { inclusive: true })
    )
      return { day, start, end: now };
    const yesterday = this.owner.lifeDay(start - MINUTE);
    const before = this.owner.dayStart(start - MINUTE);
    if (
      !bedtime &&
      !has(yesterday) &&
      this.owner.mind.days.participated(before, start)
    )
      return { day: yesterday, start: before, end: start };
    return null;
  }
  dayStart(now) {
    return lifeDayStart(
      this.owner.mind.nature.current(now),
      now,
      this.owner.mind.timeZone(),
    );
  }
  diaryLine(entry, now = this.owner.now()) {
    const closed =
      this.owner.mind.meetings.privateBeyond(entry.day, "", now) ||
      !this.owner.mind.meetings.sayable(entry.content, "");
    const compare =
      !closed &&
      entry.compare &&
      this.owner.mind.meetings.sayable(entry.compare, "")
        ? text(entry.compare, 120)
        : "";
    return {
      ref: `d:${entry.day}`,
      day: entry.day,
      ...(entry.mood ? { mood: entry.mood } : {}),
      content: closed
        ? "这一天有留在私下的事，原文不带到回顾里。"
        : text(entry.content, 400),
      ...(compare ? { compare } : {}),
      ...(closed ? { private: true } : {}),
    };
  }
  openWords(value, limit) {
    let out = String(value || "");
    for (const saying of this.owner.mind.meetings.privateSayings(""))
      if (saying.content) out = out.split(saying.content).join("");
    out = out
      .replace(/[。！？]{2,}/g, (mark) => mark[0])
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!out || !this.owner.mind.meetings.sayable(out, "")) return "";
    return text(out, limit);
  }
  openThreads(rows, now = this.owner.now()) {
    const known = this.owner.mind.self.latest(now);
    return (rows || []).filter((item) => {
      const row = known.find((thread) => thread.thread === item.thread);
      return !!row && this.owner.mind.meetings.stays(row, "");
    });
  }
  chapterView(now, size = 120) {
    const chapter = this.owner.mind.periods.current(now);
    if (!chapter) return null;
    const gist = this.#presentLifeWriting(chapter.content, now, size);
    return {
      number: chapter.chapter,
      title: chapter.title,
      ...(gist ? { gist } : {}),
    };
  }
  #lifeMoved(now) {
    const living = this.owner.mind.self.living({ now, before: now });
    const chapter = this.owner.mind.periods.current(now);
    return !!(
      living &&
      ownLife(living.content) &&
      chapter &&
      !aboutLife(living.content, chapter.content)
    );
  }
  #presentLifeWriting(content, now, size) {
    let body = String(content || "");
    const living = this.owner.mind.self.living({ now, before: now });
    if (
      living &&
      ownLife(living.content) &&
      body &&
      !aboutLife(living.content, body)
    ) {
      const duties = this.owner.mind.self
        .latest(now)
        .filter(
          (row) =>
            row.kind === "intention" &&
            row.status !== "closed" &&
            !ownLife(row.content),
        );
      body = body
        .split(/(?<=[。\n])/)
        .filter((sentence) => {
          if (
            /为自己而活的那件事/.test(sentence) &&
            !aboutLife(living.content, sentence)
          )
            return false;
          return !duties.some((row) => aboutLife(row.content, sentence));
        })
        .join("");
    }
    return this.owner.openWords(body, size);
  }
  async review({ day, start, end }) {
    this.owner.busy = true;
    const now = this.owner.now();
    const id = this.owner.run("daily", `写 ${day} 的日记`);
    const trace = this.owner.repo.trace("__mind__", "daily");
    let status = "empty";
    let reason = "今天没有写下什么";
    let summary = { day };
    try {
      const nature = this.owner.mind.nature.current(now);
      const since =
        this.owner.db
          .prepare(
            `SELECT COALESCE(MIN(seq),1)-1 n FROM core_events WHERE time>? AND ${LIVE}`,
          )
          .get(start).n || 0;
      const experiences = this.owner.experiences(since, end, {
        limit: 6,
        rows: 14,
      });
      const thoughts = this.owner.db
        .prepare(
          "SELECT * FROM mind_thoughts WHERE created>? AND created<=? AND hidden=0 ORDER BY created LIMIT 10",
        )
        .all(start, end);
      const choices = this.owner.db
        .prepare(
          "SELECT choice,COUNT(*) n FROM mind_choices WHERE created>? AND created<=? GROUP BY choice",
        )
        .all(start, end);
      const moods = this.owner.mind.affect
        .history({ before: end, limit: 40 })
        .filter((a) => a.created > start)
        .slice(0, 12)
        .map((a) => ({
          at: localClock(a.created, this.owner.mind.timeZone()).local.slice(11),
          feeling: a.feeling,
          cause: text(a.cause, 50),
        }));
      const previousDay = this.owner.db
        .prepare(
          "SELECT day FROM mind_snapshots WHERE day<? ORDER BY day DESC LIMIT 1",
        )
        .get(day)?.day;
      const yesterday = previousDay
        ? this.owner.mind.snapshotOf(previousDay)
        : null;
      const yesterdayLife = yesterday
        ? this.owner.mind.livedThen(yesterday)
        : null;
      const lastDiary = this.owner.db
        .prepare(
          "SELECT day,content,compare FROM mind_diary WHERE day<? ORDER BY day DESC, created DESC LIMIT 1",
        )
        .get(day);
      const earlierDiary =
        lastDiary &&
        !this.owner.mind.meetings.privateBeyond(lastDiary.day, "", end)
          ? text(lastDiary.content, 240)
          : "";
      // Only the short account of her life and the chapter she is in, so
      // the diary does not grow with her age.
      const story = this.owner.mind.periods.story(now);
      const storyWords = this.#presentLifeWriting(story?.content, now, 600);
      const chapter = this.owner.chapterView(now);
      const anniversaries = this.owner.mind.days.anniversaries(end);
      const expected = this.owner.mind.anticipations.today({ start, end });
      const open = this.owner.mind.anticipations.due({
        now: end,
        limit: 5,
        shareable: true,
      });
      const ahead = Object.fromEntries(
        Object.entries({ ...expected, open }).filter(([, v]) => v.length),
      );
      const input = {
        date: day,
        dayOfLife: this.owner.mind.days.dayOfLife(end),
        today: {
          moods,
          thoughts: thoughts.map((t) => ({
            id: t.id,
            content: text(t.content, 200),
          })),
          choices: Object.fromEntries(choices.map((c) => [c.choice, c.n])),
          feedback: this.owner.feedbackSince(start),
          ...(Object.keys(ahead).length ? { ahead } : {}),
          experiences,
          meetings: this.owner.mind.meetings.held({
            since: start,
            before: end,
            limit: 6,
          }),
        },
        yesterday: yesterday
          ? {
              day: yesterday.day,
              mood: yesterday.affect?.mood,
              ...(yesterdayLife
                ? { livingFor: text(yesterdayLife.content, 80) }
                : {}),
              self: (yesterday.self || [])
                .filter((t) => {
                  const row = this.owner.mind.self
                    .latest(yesterday.created || end)
                    .find((item) => item.thread === t.thread);
                  return row && this.owner.mind.meetings.stays(row, "");
                })
                .slice(0, 12)
                .map(
                  (t) =>
                    `${SELF_KINDS[t.kind] || t.kind}：${t.content}（${t.strength}）`,
                ),
              ...(earlierDiary ? { diary: earlierDiary } : {}),
            }
          : null,
        self: this.owner.selfView(now, { open: true }),
        faces: this.owner.faceView(experiences, now),
        livedTraits: this.owner.mind.traits.current(nature, now),
        livedPersona:
          this.owner.mind.traits.persona(nature, now)?.content || "",
        ...(this.owner.livingForView(end, { since: start, open: true })
          ? {
              livingFor: this.owner.livingForView(end, {
                since: start,
                open: true,
              }),
            }
          : {}),
        people: this.owner.peopleIn(experiences, now, { open: true }),
        ...(storyWords ? { story: storyWords } : {}),
        ...(chapter
          ? {
              chapter: {
                ...chapter,
                gist: this.owner.openWords(chapter.gist, 120) || undefined,
              },
            }
          : {}),
        ...(anniversaries.length ? { anniversaries } : {}),
      };
      if (!input.today.meetings.length) delete input.today.meetings;
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.today.experiences.some((e) => e.messages.length > 3)
      )
        for (const e of input.today.experiences)
          if (e.messages.length > 3) e.messages.shift();
      while (
        estimateTokens(input) > SOLITUDE_INPUT_CAP &&
        input.today.meetings?.length > 2
      )
        input.today.meetings.shift();
      const result = await this.owner.chat.models.call(
        this.owner.profile(),
        "daily",
        replyPrompt(nature, prompts(this.owner.repo), "daily"),
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
        ...(input.livingFor ? [`s:${input.livingFor.thread}`] : []),
        ...(input.today.meetings || []).map((m) => m.ref),
      ]);
      this.owner.db
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
      const applied = this.owner.grow(result, valid, "daily", now);
      applied.letGo = this.owner.letGo(
        result?.letGo,
        new Set(thoughts.map((t) => t.id)),
        now,
      );
      Object.assign(
        applied,
        this.owner.anticipate(result, {
          valid,
          shown: new Set(open.map((a) => a.ref.slice(2))),
          origin: "daily",
          now,
        }),
      );
      if (result.mood)
        this.owner.mind.affect.feel({
          feeling: result.mood,
          intensity: 0.2,
          valence: 0,
          cause: "写完了今天的日记",
          origin: "daily",
          time: now,
        });
      this.owner.mind.snapshot(now, day);
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
      this.owner.chat.finishQuietly(
        trace,
        status === "error" ? "error" : "complete",
      );
      this.owner.end(id, status, reason, trace, summary);
      this.owner.busy = false;
    }
    return { status, reason, runId: id };
  }
  chapters() {
    return this.owner.mind.periods.chapters();
  }
  chapterVersions(chapter) {
    return this.owner.mind.periods.chapterVersions(chapter);
  }
  isNight(now = this.owner.now()) {
    if (this.owner.mind.nature.current(now).rhythm?.enabled)
      return this.owner.phase(now).key === "asleep";
    const hour = localClock(now, this.owner.mind.timeZone()).hour;
    return hour >= 3 && hour < 6;
  }
  nightDue(now = this.owner.now()) {
    if (!this.owner.settings().night || !this.owner.isNight(now)) return null;
    try {
      this.owner.profile();
    } catch {
      return null;
    }
    const day = this.owner.lifeDay(now);
    if (
      this.owner.mind.budget.allows("upkeep", now) &&
      this.owner.repo.store.settings().memoryEnabled !== false
    ) {
      const done = this.owner.db.prepare(
        "SELECT 1 FROM mind_runs WHERE kind='night' AND json_extract(summary,'$.day')=? AND json_extract(summary,'$.session')=? LIMIT 1",
      );
      for (const { id } of this.owner.living())
        if (
          !this.owner.mind.memory.busy.has(id) &&
          this.owner.mind.memory.pending(id) >= NIGHT_PENDING &&
          !done.get(day, id)
        )
          return { kind: "memory", session: id, day };
    }
    if (this.owner.reviewDue(now)) return { kind: "review" };
    return null;
  }
  async rememberAtNight(session, day, now = this.owner.now()) {
    this.owner.busy = true;
    const name =
      this.owner.living().find((s) => s.id === session)?.name || session;
    const id = this.owner.run("night", `夜里整理「${name}」里的事`);
    const trace = this.owner.repo.trace(session, "memory");
    let status = "empty";
    let reason = "没有需要整理的";
    try {
      const profile = this.owner.profile();
      const models = withFallback(
        this.owner.chat.models,
        this.owner.chat.fallbackFor(null, profile, trace),
      );
      const before = this.owner.mind.memory.pending(session);
      await this.owner.mind.memory.consolidate(
        session,
        profile,
        prompts(this.owner.repo).memory,
        trace,
        { force: true, models, now },
      );
      const left = this.owner.mind.memory.pending(session);
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
      this.owner.chat.finishQuietly(
        trace,
        status === "error" ? "error" : "complete",
      );
      this.owner.end(id, status, reason, trace, { day, session });
      this.owner.busy = false;
    }
    return { status, reason, runId: id };
  }
  reviewDue(now = this.owner.now()) {
    const s = this.owner.settings();
    if (!s.diary || !this.owner.mind.budget.allows("inner", now)) return false;
    const last = this.owner.mind.periods.lastReview(now);
    const written = this.owner.db
      .prepare(
        "SELECT COUNT(DISTINCT day) n FROM mind_diary WHERE created>? AND created<=?",
      )
      .get(last?.created ?? 0, now).n;
    if (written < 2) return false;
    const wait = this.#lifeMoved(now) ? DAY : s.chapterDays * DAY - 6 * HOUR;
    if (last && now - last.created < wait) return false;
    const tries = this.owner.db
      .prepare(
        "SELECT COUNT(*) n, MAX(started) last FROM mind_runs WHERE kind='weekly' AND status='error' AND started>=?",
      )
      .get(this.owner.dayStart(now));
    return !(tries.n >= 3 || (tries.last && now - tries.last < 3 * HOUR));
  }
  async reviewPeriod(now = this.owner.now()) {
    this.owner.busy = true;
    const id = this.owner.run("weekly", "回顾这一段日子");
    const trace = this.owner.repo.trace("__mind__", "weekly");
    let status = "empty";
    let reason = "这次没有写下回顾";
    let summary = null;
    try {
      const nature = this.owner.mind.nature.current(now);
      const periods = this.owner.mind.periods;
      const last = periods.lastReview(now);
      const start =
        last?.period_end ??
        this.owner.mind.days.born() ??
        now - this.owner.settings().chapterDays * DAY;
      const diaries = [
        ...new Map(
          this.owner.db
            .prepare(
              "SELECT * FROM mind_diary WHERE created>? AND created<=? ORDER BY day, created",
            )
            .all(last?.created ?? 0, now)
            .map((d) => [d.day, d]),
        ).values(),
      ].slice(-10);
      const first = diaries[0]?.day;
      const earlier = first
        ? this.owner.db
            .prepare(
              "SELECT day FROM mind_snapshots WHERE day<? ORDER BY day DESC LIMIT 1",
            )
            .get(first)?.day
        : null;
      const latest = this.owner.db
        .prepare(
          "SELECT day FROM mind_snapshots WHERE created<=? ORDER BY day DESC LIMIT 1",
        )
        .get(now)?.day;
      const earlierSnap = earlier ? this.owner.mind.snapshotOf(earlier) : null;
      const latestSnap = latest ? this.owner.mind.snapshotOf(latest) : null;
      const asLived = (snap) =>
        snap ? { ...snap, livingFor: this.owner.mind.livedThen(snap) } : null;
      const change =
        earlierSnap && latestSnap
          ? diffSnapshots(asLived(earlierSnap), asLived(latestSnap))
          : null;
      const chapter = periods.current(now);
      const previous = chapter
        ? periods.chapters(now).find((c) => c.chapter === chapter.chapter - 1)
        : null;
      const story = periods.story(now);
      const { kept, missed } = this.owner.mind.anticipations.today({
        start,
        end: now,
        shareable: true,
      });
      const anniversaries = this.owner.mind.days.anniversaries(now);
      const line = (t) =>
        `${SELF_KINDS[t.kind] || t.kind}：${text(t.content, 60)}`;
      const lastReview = last
        ? this.#presentLifeWriting(last.content, now, 300)
        : "";
      const storyWords = story
        ? this.#presentLifeWriting(story.content, now, 600)
        : "";
      const previousWords = previous
        ? this.#presentLifeWriting(previous.content, now, 160)
        : "";
      const input = {
        dayOfLife: this.owner.mind.days.dayOfLife(now),
        period: { from: first, to: diaries.at(-1)?.day },
        diaries: diaries.map((d) => this.owner.diaryLine(d, now)),
        ...(last
          ? {
              lastReview: {
                ...(lastReview ? { content: lastReview } : {}),
                ...(last.compare ? { compare: text(last.compare, 120) } : {}),
              },
            }
          : {}),
        ...(change
          ? {
              changes: {
                appeared: this.owner
                  .openThreads(change.appeared, now)
                  .slice(0, 6)
                  .map(line),
                faded: this.owner
                  .openThreads(change.faded, now)
                  .slice(0, 6)
                  .map(line),
                changed: this.owner
                  .openThreads(change.changed, now)
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
                ...(change.livingFor
                  ? {
                      livingFor: `${text(change.livingFor.from, 40) || "还没有"} → ${text(change.livingFor.to, 40) || "还没有"}`,
                    }
                  : {}),
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
                content: this.#presentLifeWriting(chapter.content, now, 800),
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
                ...(previousWords ? { summary: previousWords } : {}),
              },
            }
          : {}),
        ...(storyWords ? { story: storyWords } : {}),
        ...(anniversaries.length ? { anniversaries } : {}),
        self: this.owner.selfView(now, { open: true }).slice(0, 10),
        ...(this.owner.livingForView(now, { since: start, open: true })
          ? {
              livingFor: this.owner.livingForView(now, {
                since: start,
                open: true,
              }),
            }
          : {}),
      };
      const result = await this.owner.chat.models.call(
        this.owner.profile(),
        "weekly",
        replyPrompt(nature, prompts(this.owner.repo), "weekly"),
        input,
        trace,
      );
      const week = text(result?.week, 1500);
      if (!week || hasCredential(week)) throw SyntaxError("回顾格式无效");
      const valid = new Set([
        ...diaries.map((d) => `d:${d.day}`),
        ...(input.livingFor ? [`s:${input.livingFor.thread}`] : []),
      ]);
      periods.write("week", {
        start,
        end: now,
        content: week,
        compare: result?.compare,
        sources: [...valid],
        runId: id,
        time: now,
      });
      const applied = this.owner.grow(
        { self: result.self, bonds: result.bonds },
        valid,
        "weekly",
        now,
      );
      const turned = this.owner.turnChapter(result?.chapter, {
        chapter,
        start,
        now,
        runId: id,
      });
      const told = text(result?.story, 1800);
      const prior = story?.content || "";
      const living = input.livingFor?.content || "";
      const livingMoved = Boolean(living) && !prior.includes(living);
      const retold =
        !!told &&
        told !== prior &&
        !hasCredential(told) &&
        (turned.opened || !story || livingMoved);
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
      this.owner.chat.finishQuietly(
        trace,
        status === "error" ? "error" : "complete",
      );
      this.owner.end(id, status, reason, trace, summary);
      this.owner.busy = false;
    }
    return { status, reason, runId: id };
  }
  turnChapter(value, { chapter, start, now, runId }) {
    const none = { number: null, opened: false };
    if (!value || typeof value !== "object") return none;
    if (!["continue", "close"].includes(value.action)) return none;
    const title = text(value.title, 60);
    const content = text(value.content, 2400);
    if (!title || !content || hasCredential(content)) return none;
    const periods = this.owner.mind.periods;
    if (!chapter)
      return {
        number: periods.writeChapter({
          number: 1,
          title,
          content,
          start: this.owner.mind.days.born() ?? start,
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
    return this.owner.db
      .prepare(
        "SELECT * FROM mind_diary WHERE day<=? ORDER BY day DESC, created DESC LIMIT ?",
      )
      .all(before, limit)
      .map((d) => ({ ...d, sources: parse(d.sources, []) }));
  }
}
