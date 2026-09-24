import { createApp } from "../../server/app.js";
import { world, HOUR, MINUTE } from "./world.js";

const NAMES = { 10001: "阿明", 10002: "小红", 10003: "老周" };

// Three days of a small life: chats in two groups and a private chat, a
// sad moment, solitude, diaries, things remembered and things to wait for.
export async function livedWorld() {
  const w = world({ start: "2026-09-20T09:00:00+08:00" });
  w.open("group:12345", "春日聊天室");
  w.open("private:10001", "阿明");
  w.open("group:23456", "学习群");
  const say = (session, user, text) =>
    w.say(session, user, text, { name: NAMES[user] });

  w.answers.turn = (data) => {
    const ctx = data.context;
    const batch = ctx.messages.filter((m) => ctx.batchIds.includes(m.id));
    const t = batch.at(-1);
    const sad = /难过|累|紧张/.test(t.text);
    return {
      appraisal: sad ? `${t.name}好像不太好` : `${t.name}在叫我`,
      feelings: [
        sad
          ? {
              feeling: "心疼",
              intensity: 0.5,
              valence: -0.35,
              arousal: 0.3,
              cause: [t.id],
            }
          : {
              feeling: "开心",
              intensity: 0.45,
              valence: 0.55,
              arousal: 0.6,
              cause: [t.id],
            },
      ],
      bonds: [
        {
          userId: t.speaker,
          change: "warmer",
          why: sad ? "愿意跟我说难过的事" : "主动找我",
          evidence: [t.id],
        },
      ],
      choice: "speak",
      reason: sad ? `先接住${t.name}的情绪` : `回应${t.name}`,
      targetMessageIds: [t.id],
      bubbles: sad ? ["抱抱你", "慢慢说，我在听"] : ["在呢"],
    };
  };
  w.answers.reflection = (data) => {
    const m = data.experiences.flatMap((e) => e.messages).find((x) => x.userId);
    return {
      thought: {
        kind: "unfinished",
        content: "阿明在准备面试，结果还不知道",
        sources: [m.seq],
      },
      self: [
        {
          action: "new",
          kind: "care",
          content: "我有点在意阿明的面试",
          sources: [m.seq],
        },
        {
          action: "new",
          kind: "interest",
          content: "我喜欢听大家说各自在忙什么",
        },
      ],
      faces: [
        { session: "group:12345", role: "偶尔接话的那个", sources: [m.seq] },
      ],
      mood: { feeling: "安静", intensity: 0.2, valence: 0.1 },
    };
  };
  w.answers.daily = (data) => ({
    diary: data.yesterday
      ? "小红说今天好累，我陪她说了一会儿话。阿明还在准备面试。"
      : "今天阿明说要去面试，我有点替他紧张。",
    mood: data.yesterday ? "有点心疼" : "平静",
    compare: data.yesterday ? "比昨天更在意大家了" : "今天是开始",
    self: [],
    chapter: null,
  });

  const quiet = (session, user, texts) => {
    for (const text of texts) {
      say(session, user, text);
      w.advance(MINUTE);
    }
  };

  await w.hear("group:12345", say("group:12345", "10001", "LuckyBot，早上好"));
  quiet("group:12345", "10002", ["今天吃什么", "食堂又涨价了", "哈哈哈"]);
  await w.hear(
    "private:10001",
    say("private:10001", "10001", "LuckyBot，我下周要面试了"),
  );
  w.at("2026-09-20T11:00:00+08:00");
  await w.life.tick();
  w.at("2026-09-20T23:30:00+08:00");
  await w.life.tick();

  w.at("2026-09-21T10:00:00+08:00");
  await w.hear(
    "group:12345",
    say("group:12345", "10002", "LuckyBot，今天好累啊"),
  );
  quiet("group:12345", "10001", ["抱抱小红", "早点休息"]);
  await w.hear(
    "group:23456",
    say("group:23456", "10003", "LuckyBot，这道题怎么做"),
  );
  w.at("2026-09-21T23:30:00+08:00");
  await w.life.tick();

  w.at("2026-09-22T09:00:00+08:00");
  await w.hear(
    "group:12345",
    say("group:12345", "10001", "LuckyBot，我明天面试"),
  );
  quiet("group:12345", "10001", ["准备第一题", "准备第二题", "准备第三题"]);
  await w.hear("private:10001", say("private:10001", "10001", "有点紧张"));
  w.at("2026-09-22T11:00:00+08:00");
  await w.life.tick();

  w.at("2026-09-22T14:00:00+08:00");
  const day = (offset) =>
    new Date(w.now() + offset * 24 * HOUR + 8 * HOUR)
      .toISOString()
      .slice(0, 10);
  w.mind.anticipations.add({
    kind: "event",
    subject: "10001",
    session: "private:10001",
    content: "面试",
    due: day(1),
    sources: [1],
    time: w.now(),
  });
  w.mind.anticipations.add({
    kind: "promise",
    subject: "10002",
    session: "group:12345",
    content: "周末陪小红聊聊新学期",
    due: day(4),
    sources: [1],
    time: w.now(),
  });
  w.mind.memory.insert({
    session: "private:10001",
    subject: "10001",
    content: "阿明在准备一家游戏公司的面试",
    importance: 0.7,
    time: w.now(),
  });
  w.mind.memory.insert({
    session: "group:12345",
    subject: "10002",
    content: "小红最近课很多，经常说累",
    importance: 0.6,
    time: w.now(),
  });
  return w;
}

export async function serve(w, port = 0) {
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  }).listen(port, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
