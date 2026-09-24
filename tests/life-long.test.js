import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../server/core/model-manager.js";
import { world, MINUTE } from "./helpers/world.js";

// Months of her life with a scripted model. The point is not what she says
// but what time does to her: things fade and come back, people drift and
// return, what she was waiting for arrives, and nothing she carries grows
// without bound. LIFE_DAYS=365 lives a whole year.
const DAYS = Math.max(120, Number(process.env.LIFE_DAYS) || 120);
const QUIET = [41, 70];
const STUDY = "group:3001";
const GAME = "group:3002";
const MING = "private:10001";
const NAMES = { 10001: "阿明", 10002: "小红", 10003: "老王", 10004: "小李" };
const STARS = [
  "今晚看星星吗",
  "天文望远镜好贵",
  "猎户座好亮",
  "流星雨什么时候来",
];
const BAKING = ["周末烤了蛋糕", "烘焙好难", "面包发不起来", "戚风又塌了"];

const dateOf = (day) =>
  new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10);
const iso = (day, clock) => `${dateOf(day)}T${clock}:00+08:00`;
const at = (day, clock) => Date.parse(iso(day, clock));
const quiet = (day) => day >= QUIET[0] && day <= QUIET[1];
const body = (value, drop) => {
  const { [drop]: _drop, ...rest } = value;
  return estimateTokens(rest);
};

function script(w, state) {
  const seen = { reflection: [], daily: [], weekly: [] };
  const find = (messages, re) =>
    messages.find((m) => m.userId && re.test(m.text));
  w.answers.turn = (data) => {
    const ctx = data.context;
    const batch = ctx.messages.filter((m) => ctx.batchIds.includes(m.id));
    const direct = batch.filter((m) => m.relation === "direct");
    if (!direct.length) return { choice: "silent", reason: "听着" };
    return {
      appraisal: "有人找我",
      choice: "speak",
      reason: "回应",
      targetMessageIds: [direct.at(-1).id],
      bubbles: ["嗯嗯"],
    };
  };
  w.answers.summary = { summary: "聊天", keyPoints: [] };
  w.answers.memory = (data) => {
    const facts = [];
    const anticipations = [];
    for (const m of data.messages) {
      const cat = m.role === "user" && m.text.match(/^我喜欢(猫)$/);
      if (cat)
        facts.push({
          subject: m.userId,
          content: "喜欢猫",
          type: "preference",
          confidence: 0.9,
          importance: 0.4,
          sources: [m.id],
          certainty: "self_report",
          discretion: "open",
        });
      const moved = m.role === "user" && m.text.match(/搬到(\S+?)了/);
      if (moved)
        facts.push({
          subject: m.userId,
          content: `住在${moved[1]}`,
          type: "event",
          confidence: 0.9,
          importance: 0.7,
          sources: [m.id],
          certainty: "self_report",
          discretion: "private",
          supersedes: (data.known || [])
            .filter((k) => k.subject === m.userId && /^住在/.test(k.content))
            .map((k) => k.ref),
        });
      const exam = m.role === "user" && m.text.match(/^我(\d+)号考(\S+)$/);
      if (exam)
        anticipations.push({
          kind: "event",
          subject: m.userId,
          content: `考${exam[2]}`,
          due: `${m.localTime.slice(0, 8)}${exam[1].padStart(2, "0")}`,
          sources: [m.id],
        });
      const promise =
        m.role === "assistant" && m.text.match(/^我(\d+)号提醒你(\S+)$/);
      if (promise)
        anticipations.push({
          kind: "promise",
          subject: "10001",
          content: `提醒阿明${promise[2]}`,
          due: `${m.localTime.slice(0, 8)}${promise[1].padStart(2, "0")}`,
          sources: [m.id],
        });
    }
    return { summary: "聊天", facts, self: [], anticipations };
  };
  w.answers.reflection = (data) => {
    seen.reflection.push({ day: state.day, data });
    const all = data.experiences.flatMap((e) => e.messages);
    const day = state.day;
    const self = [];
    const bonds = [];
    const star = find(all, /星|天文/);
    const bake = find(all, /烘焙|蛋糕|面包|戚风/);
    const any = all.find((m) => m.userId);
    if (star && [1, 6, 11].includes(day))
      self.push({
        action: "new",
        kind: "interest",
        content: "我喜欢和大家聊天文",
        sources: [star.seq],
      });
    if (star && day === 2)
      self.push({
        action: "new",
        kind: "curiosity",
        content: "我好奇天文望远镜该怎么选",
        sources: [star.seq],
      });
    if (any && [2, 5, 9, 12].includes(day))
      self.push({
        action: "new",
        kind: "trait",
        content: "我是个慢热的人",
        sources: [any.seq],
      });
    if (bake && day % 4 === 0)
      self.push({
        action: "new",
        kind: "interest",
        content: "我对烘焙越来越感兴趣",
        sources: [bake.seq],
      });
    const rude = find(all, /你真烦/);
    if (rude)
      self.push({
        action: "new",
        kind: "view",
        content: "我觉得老王有点烦",
        sources: [rude.seq],
      });
    const wang = all.find((m) => m.userId === "10003");
    if (wang && day <= 10)
      bonds.push({
        userId: "10003",
        change: day === 3 ? "impression" : "closer",
        why: day === 3 ? "嘴上不饶人，但挺有意思" : "聊得来",
        evidence: [wang.seq],
      });
    const done = find(all, /考完了/);
    const thought =
      day === 3 && star
        ? {
            kind: "reflection",
            content: "大家聊星星的时候我插不上话，但听着挺开心",
            sources: [star.seq],
            importance: 0.5,
          }
        : day === 25 && any
          ? {
              kind: "unfinished",
              content: "阿明最近压力好大",
              sources: [any.seq],
              importance: 0.7,
            }
          : null;
    return {
      thought,
      self,
      bonds,
      letGo:
        day === 31
          ? (data.thoughts || [])
              .filter((t) => t.content === "阿明最近压力好大")
              .map((t) => ({ id: `t:${t.id}`, why: "他后来挺好的" }))
          : [],
      closeAnticipations: done
        ? (data.ahead || [])
            .filter((a) => /考/.test(a.content))
            .map((a) => ({
              id: a.ref,
              status: "done",
              why: "他考完了",
              sources: [done.seq],
            }))
        : [],
      ...(day >= 80 && day <= 86
        ? { mood: { feeling: "开心", intensity: 0.6, valence: 1 } }
        : {}),
    };
  };
  w.answers.daily = (data) => {
    seen.daily.push({ day: state.day, data });
    return {
      diary: `${data.date}：${data.today.experiences.map((e) => e.name).join("、")}都有人在说话。`,
      compare: data.yesterday ? "和昨天差不多" : "今天是开始",
      self: [],
    };
  };
  let reviews = 0;
  w.answers.weekly = (data) => {
    seen.weekly.push({ day: state.day, data });
    reviews++;
    const turn = reviews % 4 === 0;
    return {
      week: `这段日子（${data.period.from} 到 ${data.period.to}）过得挺平常。`,
      compare: data.lastReview ? "比上次更自在一点" : "这是第一次回顾",
      self: [],
      bonds: [],
      chapter: {
        action: turn ? "close" : "continue",
        title: turn
          ? `新的一段 ${reviews}`
          : data.chapter?.title || "刚来的时候",
        content: `我在这里的第 ${data.dayOfLife} 天，${"日子慢慢过着。".repeat(30)}`,
      },
      story: `我从学习群开始认识大家，${"后来的事一点点堆起来。".repeat(40)}`,
    };
  };
  return seen;
}

async function live() {
  const w = world({ start: `${dateOf(1)}T09:00:00+08:00`, rhythm: true });
  const state = { day: 0 };
  const seen = script(w, state);
  w.open(STUDY, "学习群");
  w.open(GAME, "游戏群");
  w.open(MING, "阿明");
  const say = (session, userId, text) =>
    w.say(session, userId, text, { name: NAMES[userId] });
  const marks = {};
  const tick = () => w.life.tick();

  const salienceOf = (content) =>
    w.mind.self
      .annotated({ before: w.now(), now: w.now() })
      .find((t) => t.content === content);
  for (let day = 1; day <= DAYS; day++) {
    state.day = day;
    if (day === 71) {
      // The first morning after a silent month, before anyone speaks.
      w.at(iso(71, "09:00"));
      marks.afterQuiet = salienceOf("我对烘焙越来越感兴趣");
    }
    if (!quiet(day)) {
      // Everyday chatter reaches her through attention: mostly a glance.
      w.at(iso(day, "10:00"));
      const topic = day <= 14 ? STARS : BAKING;
      const study = [];
      for (let i = 0; i < 4; i++) {
        study.push(
          say(
            STUDY,
            i % 2 ? "10001" : "10002",
            topic[(day + i) % topic.length],
          ),
        );
        w.advance(MINUTE);
      }
      await w.hear(STUDY, study);
      const game = [say(GAME, "10004", `第${day}天打游戏`)];
      w.advance(MINUTE);
      game.push(say(GAME, "10004", "又输了"));
      w.advance(MINUTE);
      if (day <= 10) {
        game.push(
          say(GAME, "10003", day === 5 ? "你真烦" : `老王第${day}天也在`),
        );
        w.advance(MINUTE);
      }
      if (day === 3) game.push(say(GAME, "10003", "我喜欢猫"));
      await w.hear(GAME, game);
    }
    // What happened on particular days.
    if (day === 6) {
      const annoyed = w.mind.self
        .latest()
        .find((t) => t.content === "我觉得老王有点烦");
      marks.revoked = annoyed?.thread;
      if (annoyed) w.mind.revoke("self", annoyed.thread, "她不是这样想的");
    }
    if (day === 8) {
      const home = say(MING, "10001", "记住，我住在北京");
      w.mind.memory.remember({ ...home, kind: "private" });
    }
    if (day === 10) {
      marks.early = say(STUDY, "10002", "LuckyBot，今天看星星吗");
      await w.hear(STUDY, marks.early);
    }
    if (day === 20) {
      for (const line of [
        "我23号考高数",
        "好紧张",
        "复习不完了",
        "晚上还要刷题",
        "先去学了",
        "拜拜",
      ])
        say(MING, "10001", line);
    }
    if (day === 22) {
      w.at(iso(22, "11:00"));
      marks.eve = await w.hear(MING, say(MING, "10001", "在吗"));
      marks.eveInGroup = w.mind.view({
        session: STUDY,
        people: ["10001"],
        now: w.now(),
      }).inner.expecting;
    }
    if (day === 24) {
      w.at(iso(24, "11:00"));
      for (const line of ["考完了，感觉还行", "终于解放了", "晚上去吃好的"])
        say(MING, "10001", line);
    }
    if (day === 25) {
      w.at(iso(25, "11:00"));
      say(MING, "bot", "我27号提醒你交作业");
      for (const line of [
        "好呀",
        "谢谢",
        "作业好多",
        "先写一点",
        "晚点聊",
        "拜拜",
      ])
        say(MING, "10001", line);
    }
    if (day === 90) {
      for (const line of [
        "我搬到上海了",
        "新家好小",
        "离公司近",
        "周末收拾",
        "累死",
        "睡了",
      ])
        say(MING, "10001", line);
    }
    if (day === 101) {
      w.at(iso(101, "11:00"));
      marks.return = await w.hear(
        GAME,
        say(GAME, "10003", "LuckyBot，好久不见"),
      );
      marks.wangBack = w.mind.bonds.person("10003", w.now());
    }
    if (day === DAYS) {
      w.at(iso(DAYS, "12:00"));
      marks.last = await w.hear(
        STUDY,
        say(STUDY, "10002", "LuckyBot，最近在烤什么"),
      );
    }
    w.at(iso(day, "15:00"));
    await tick();
    // Afternoon observations, after the day before has been rolled up.
    w.at(iso(day, "16:00"));
    if (day === 41) marks.beforeQuiet = salienceOf("我对烘焙越来越感兴趣");
    if (day === 80) {
      const now = w.now();
      const plain = w.mind.view({ session: STUDY, people: ["10002"], now });
      const rows = w.store.db
        .prepare("SELECT COUNT(*) n FROM mind_self")
        .get().n;
      marks.cued = w.mind.view({
        session: STUDY,
        people: ["10002"],
        cue: [
          "天文望远镜到底该怎么选",
          "又聊星星了，我还是插不上话",
          "老王有点烦人",
        ],
        now,
      });
      marks.plain = plain;
      marks.cueWrites =
        w.store.db.prepare("SELECT COUNT(*) n FROM mind_self").get().n - rows;
    }
    if (day === 87) marks.goodWeek = w.mind.affect.state(w.now());
    if (day === 115) marks.laterWeeks = w.mind.affect.state(w.now());
    if (day === 100) {
      const now = w.now();
      marks.wangAway = w.mind.bonds.person("10003", now);
      marks.catWeak = w.mind.memory.retrieve(
        GAME,
        [{ userId: "10004", text: "猫" }],
        now,
        { people: ["10003"], touch: false },
      );
      marks.catStrong = w.mind.memory.retrieve(
        GAME,
        [{ userId: "10003", text: "今天好累" }],
        now,
        { people: ["10003"], touch: false },
      );
      marks.home = w.mind.memory.retrieve(
        MING,
        [{ userId: "10001", text: "最近怎么样" }],
        now,
        { people: ["10001"], touch: false },
      );
    }
    w.at(iso(day + 1, "01:30"));
    await tick();
    w.at(iso(day + 1, "03:00"));
    for (let i = 0; i < 4; i++) {
      await tick();
      w.advance(MINUTE);
    }
  }
  return { w, seen, marks };
}

test(`她的 ${DAYS} 天：会淡去也会想起，久别会变淡，等的事会来，承载的东西不随年龄无限增长`, async (t) => {
  const { w, seen, marks } = await live();
  t.after(w.close);
  const db = w.store.db;
  const byDay = (list, day) => list.find((x) => x.day === day)?.data;

  // Unreinforced things fade by the days she lived, not by the calendar.
  const curiosity = (day) =>
    w.mind.self
      .annotated({ before: at(day, "16:00"), now: at(day, "16:00") })
      .find((t) => t.content === "我好奇天文望远镜该怎么选");
  assert.equal(curiosity(20).faded, false, "刚冒出来的好奇还在");
  assert.equal(curiosity(40).faded, true, "一个多月没再碰到就淡出了");
  const early = w.mind.thoughts
    .weighed({ now: at(40, "16:00") })
    .find((t) => t.content.startsWith("大家聊星星"));
  assert(early.salience < 0.1);
  assert.equal(
    w.mind.thoughts
      .open({ now: at(40, "16:00") })
      .some((t) => t.content.startsWith("大家聊星星")),
    false,
    "很久以前的小想法不再占着心",
  );
  assert.equal(
    w.mind.thoughts
      .open({ now: at(10, "16:00") })
      .some((t) => t.content.startsWith("大家聊星星")),
    true,
  );

  // A silent month does not wear her away.
  assert.ok(marks.beforeQuiet && marks.afterQuiet);
  assert.equal(marks.afterQuiet.salience, marks.beforeQuiet.salience);

  // What is being said brings faded things back, into `inner` only, and
  // bringing them back writes nothing. What was revoked never comes back.
  assert.deepEqual(marks.cued.self, marks.plain.self, "唤起不碰可缓存的 self");
  assert.equal(marks.cueWrites, 0, "想起不产生写入");
  const reminded = (marks.cued.inner.reminded || []).join("\n");
  assert.match(reminded, /天文望远镜该怎么选（很久没想起了）/);
  assert.match(reminded, /插不上话/);
  assert.doesNotMatch(reminded, /老王有点烦/);
  assert.equal(marks.plain.inner.reminded, undefined);
  assert.ok(marks.revoked);

  // Her core stays however quiet it gets; attention follows what she cares
  // about now.
  const core = w.mind.self.active({ now: at(DAYS, "16:00"), limit: 6 });
  assert.ok(core.some((t) => t.content === "我是个慢热的人"));
  assert.ok(core.some((t) => t.content === "我对烘焙越来越感兴趣"));
  assert.ok(
    seen.reflection.some(
      ({ day, data }) =>
        day > 90 && (data.fading || []).some((f) => /天文/.test(f.content)),
    ),
    "不再聊的兴趣会作为正在淡出的线索出现在独处里",
  );

  // Looking ahead: an exam she heard about in private shows up the day
  // before, only in that chat, is asked about and closed when it is over.
  const exam = w.mind.anticipations
    .list({ now: at(22, "11:00") })
    .find((a) => /高数/.test(a.content));
  assert.ok(exam, "整理记忆时记下了他的考试");
  assert.match(
    marks.eve.snapshot.inner.expecting.join(),
    /阿明：考高数（明天）/,
  );
  assert.equal(marks.eveInGroup, undefined, "私聊里知道的事不带进群里");
  assert.equal(w.mind.anticipations.get(exam.id).status, "done");
  assert.ok(
    w.mind.anticipations.pending(at(24, "10:00")).some((a) => a.id === exam.id),
    "回看考完之前，它还在等",
  );
  // A promise she never kept is noticed on the day it lapses.
  const lapse = byDay(seen.daily, 34);
  assert.match(lapse.today.ahead.missed.join(), /提醒阿明交作业/);

  // Let go of later still counts as on her mind when looking back.
  const stress = w.mind.thoughts
    .list({ q: "压力好大" })
    .find((t) => t.content === "阿明最近压力好大");
  assert.equal(stress.status, "resolved");
  assert.ok(
    w.mind.thoughts
      .open({ now: at(30, "20:00") })
      .some((t) => t.id === stress.id),
  );
  assert.equal(
    w.mind.thoughts
      .open({ now: at(32, "20:00") })
      .some((t) => t.id === stress.id),
    false,
  );

  // A changed fact replaces the old one; old news carries its age; a faded
  // memory needs a strong cue.
  const moved = db
    .prepare(
      "SELECT status,superseded_by FROM core_memories WHERE content='住在北京'",
    )
    .get();
  assert.equal(moved.status, "superseded");
  assert.ok(moved.superseded_by);
  assert.deepEqual(
    marks.home.filter((m) => /^住在/.test(m.content)).map((m) => m.content),
    ["住在上海"],
  );
  assert.equal(
    marks.catWeak.some((m) => m.content === "喜欢猫"),
    false,
    "很久没提的小事，擦边的线索想不起来",
  );
  const cat = marks.catStrong.find((m) => m.content === "喜欢猫");
  assert.ok(cat, "本人在说话时还是会想起");
  assert.match(cat.when, /个月前知道的/);

  // Someone who drifted away: closeness thins, she notices, and warms up
  // again when they come back. The one who disappeared is in her solitude.
  assert.match(marks.wangAway.feel, /好久不见了/);
  assert(marks.wangAway.awayDays >= 80);
  const peak = w.mind.bonds.person("10003", at(11, "12:00")).closeness;
  assert(marks.wangAway.closeness < peak - 0.1, "久别让亲近变淡");
  const wang = marks.return.snapshot.inner.people.find((p) => p.id === "10003");
  assert.match(wang.away, /上次见到是 \d 个月前/);
  assert(marks.wangBack.closeness > marks.wangAway.closeness, "重逢后回暖");
  // Someone she reads every day is not greeted as a long-lost friend, even
  // though they have not talked with her for a long time.
  const ming = marks.last.snapshot.inner.people?.find((p) => p.id === "10001");
  assert.ok(ming, "阿明今天在群里说过话");
  assert.equal(ming.away, undefined, "天天在群里见到的人不算久别");
  assert.doesNotMatch(ming.feel, /好久不见/);
  assert.match(ming.lastTalked, /上次说上话是/);
  assert.ok(
    seen.reflection.some(({ data }) =>
      (data.missing || []).some((p) => p.userId === "10003" && p.ref),
    ),
    "好久没联系的人会出现在她的独处里",
  );

  // A good week lifts where she settles, then it wears off.
  assert.equal(marks.goodWeek.lately, "这阵子挺开心");
  assert(marks.goodWeek.baseline > 0.2);
  assert.equal(marks.laterWeeks.lately, "");

  // Looking back: every few nights, chapters turn, the story is rewritten
  // only when they do, and the diary never carries every chapter.
  const reviews = db
    .prepare("SELECT COUNT(*) n FROM mind_periods WHERE level='week'")
    .get().n;
  assert(reviews >= 10, `回顾了 ${reviews} 次`);
  const chapters = w.life.chapters();
  assert(chapters.length >= 3, "日子换了样子时翻开新的一章");
  const stories = w.mind.periods.storyVersions(100).length;
  assert(stories <= chapters.length + 1, "只有翻篇时才重写我的来路");
  for (const { data } of seen.daily) {
    assert.equal(data.chapters, undefined);
    assert(!data.story || data.story.length <= 600);
  }
  for (const { data } of seen.weekly) {
    assert(!data.chapter || data.chapter.content.length <= 800);
    assert(data.diaries.length <= 10);
  }

  // Nothing she carries into a call grows with her age.
  const last = marks.last.snapshot;
  assert(
    estimateTokens(last.self) + estimateTokens(last.inner) < 1500,
    "回合里的 self 和 inner 仍然只有几百 Token",
  );
  const lateSolitude = seen.reflection.at(-1).data;
  const earlySolitude = byDay(seen.reflection, 30);
  assert(body(lateSolitude, "experiences") < 5000);
  assert(
    body(lateSolitude, "experiences") < body(earlySolitude, "experiences") * 3,
  );
  const lateDiary = seen.daily.at(-1).data;
  const earlyDiary = byDay(seen.daily, 30);
  const diarySize = (d) =>
    estimateTokens(d) - estimateTokens(d.today.experiences);
  assert(diarySize(lateDiary) < 5000);
  assert(diarySize(lateDiary) < diarySize(earlyDiary) * 3);
  assert(estimateTokens(seen.weekly.at(-1).data) < 8000);

  // Looking back at day ten sees only what she was then.
  const before = w.calls.length;
  const replay = await w.system.process(STUDY, [marks.early], { replay: true });
  assert.equal(replay.status, "replayed");
  const past = JSON.stringify(
    w.calls.slice(before).find((c) => c.stage === "turn").data,
  );
  assert.doesNotMatch(past, /烘焙|上海|高数/);
  assert(
    w.mind.days.lived(at(30, "12:00")).count <
      w.mind.days.lived(at(DAYS, "12:00")).count,
  );

  // Every background call is on the ledger, the new review included.
  const stages = new Set(
    db
      .prepare("SELECT DISTINCT stage FROM mind_usage")
      .all()
      .map((r) => r.stage),
  );
  for (const stage of ["turn", "reflection", "daily", "weekly", "memory"])
    assert.ok(stages.has(stage), `${stage} 记在账上`);
});
