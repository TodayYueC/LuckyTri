// What she can do besides typing: quote a message, poke someone, put a
// reaction on a message, throw a die or play rock-paper-scissors, take back
// her own last line. They belong to her the way words do: offered only when
// this channel can do them right now, chosen by her, never by a counter.

// QQ face ids accepted by set_msg_emoji_like; a short list she can
// name. Unknown names are dropped, not guessed.
export const REACTIONS = {
  赞: "76",
  爱心: "66",
  笑哭: "182",
  哈哈: "101",
  抱抱: "49",
  OK: "124",
  鼓掌: "99",
  疑问: "32",
  震惊: "110",
  玫瑰: "63",
};

const NOTES = {
  reply: "reply:{to:消息序号}，引用那条再说（话题被刷下去、或要明确接哪句时）",
  poke: "poke:{to:userId}，戳一下（逗人、叫人、回戳）",
  react: `react:{to:消息序号,emoji:${Object.keys(REACTIONS).join("|")}}，给那条点个表情回应，可以不说话`,
  dice: "dice:{}，扔个骰子",
  rps: "rps:{}，出个猜拳",
  recall: "recall:{}，撤回自己刚发的上一条（只在发错了的时候）",
  voice:
    "voice:{}，这句用说的发语音（60字内）；有人请你唱歌，你此刻心情好也想唱，可以把歌词写进 say 并选 voice，不想就不唱",
  music:
    'music:{query:"歌名 歌手"}，分享一首歌的卡片（真想推荐、或有人要歌时）',
  forward:
    "forward:{ids:[消息序号,…]}，把这里的几条消息打包成合并转发发出来（翻旧账、给人看前情时，最多20条）",
  file: 'file:{name:"标题",text:"全文"}，把你自己写的东西作为 .md 文件发出来（篇幅长、对方要文件时）',
};

// Guards against a burst, per session, in her time.
const LIMITS = {
  poke: { per: 10 * 60000, max: 1, key: "to" },
  react: { per: 3600000, max: 6 },
  dice: { per: 3600000, max: 3 },
  rps: { per: 3600000, max: 3 },
  recall: { per: 3600000, max: 2 },
  voice: { per: 3600000, max: 3 },
  music: { per: 3600000, max: 3 },
  forward: { per: 3600000, max: 2 },
  file: { per: 3600000, max: 2 },
};

export class ActionLedger {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    db?.exec?.(
      "CREATE TABLE IF NOT EXISTS core_action_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, direction TEXT NOT NULL, type TEXT NOT NULL, target TEXT, detail TEXT, result TEXT, time INTEGER NOT NULL)",
    );
  }
  count(session, type, since, target) {
    if (!this.db) return 0;
    return this.db
      .prepare(
        `SELECT COUNT(*) n FROM core_action_events WHERE session_id=? AND type=? AND direction='out' AND result='done' AND time>=?${target ? " AND target=?" : ""}`,
      )
      .get(session, type, since, ...(target ? [String(target)] : [])).n;
  }
  allowed(session, type, target) {
    const limit = LIMITS[type];
    if (!limit) return true;
    return (
      this.count(
        session,
        type,
        this.now() - limit.per,
        limit.key ? target : undefined,
      ) < limit.max
    );
  }
  record(
    session,
    { direction = "out", type, target = "", detail = "", result },
  ) {
    this.db
      ?.prepare(
        "INSERT INTO core_action_events(session_id,direction,type,target,detail,result,time) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        session,
        direction,
        type,
        String(target),
        detail,
        result,
        this.now(),
      );
  }
}

// What reaches her this turn: only what this channel can do here now.
export function actionOffer(available, snapshot, session, ledger) {
  if (!Array.isArray(available) || !available.length) return [];
  if (snapshot.initiative || snapshot.stopped) return [];
  return available.filter(
    (type) =>
      NOTES[type] &&
      (type !== "recall" ||
        (snapshot.messages || []).some((m) => m.role === "assistant")) &&
      (!ledger || type === "poke" || ledger.allowed(session, type)),
  );
}

export function actionNote(offered) {
  return {
    actions: offered.map((type) => NOTES[type]),
    actionsNote:
      '想做时返回 actions:[{"type":"…",…}]，最多两个；不做就不写。和说话一样由你决定，不用为用而用。',
  };
}

// What she chose, kept only when it points at something real this turn.
export function chosenActions(raw, snapshot) {
  const offered = new Set(snapshot.actionsOffered || []);
  if (!offered.size || !Array.isArray(raw)) return [];
  const byIndex = (to) =>
    (snapshot.batch || []).find((m) => String(m.id) === String(to)) ||
    (snapshot.messages || []).find(
      (m) => m.role === "user" && String(m.id) === String(to),
    );
  const people = new Map(
    [
      ...(snapshot.canAt || []),
      ...(snapshot.batch || []).map((m) => ({
        userId: String(m.speaker ?? m.userId ?? ""),
        name: m.name,
      })),
    ]
      .filter((p) => p.userId)
      .map((p) => [String(p.userId), p]),
  );
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || !offered.has(item.type)) continue;
    if (out.some((a) => a.type === item.type)) continue;
    if (item.type === "reply" || item.type === "react") {
      const m = byIndex(item.to);
      if (!m?.platformId) continue;
      if (item.type === "react" && !REACTIONS[item.emoji]) continue;
      out.push({
        type: item.type,
        to: m.id,
        platformId: String(m.platformId),
        name: m.name || "",
        ...(item.type === "react" ? { emoji: item.emoji } : {}),
      });
    } else if (item.type === "poke") {
      const p = people.get(String(item.to ?? ""));
      if (!p) continue;
      out.push({ type: "poke", to: p.userId, name: p.name || "" });
    } else if (item.type === "music") {
      const query = String(item.query || "")
        .trim()
        .slice(0, 60);
      if (!query) continue;
      out.push({ type: "music", query });
    } else if (item.type === "forward") {
      const ids = (Array.isArray(item.ids) ? item.ids : [])
        .map((id) =>
          (snapshot.messages || []).find((m) => String(m.id) === String(id)),
        )
        .filter((m) => m?.platformId)
        .slice(0, 20);
      if (!ids.length) continue;
      out.push({
        type: "forward",
        platformIds: [...new Set(ids.map((m) => String(m.platformId)))],
      });
    } else if (item.type === "file") {
      const text = String(item.text || "").trim();
      const name = String(item.name || "")
        .replace(/[\\/:*?"<>|\n\r]/g, "")
        .trim()
        .slice(0, 40);
      if (!text || !name || text.length > 20000) continue;
      out.push({ type: "file", name: `${name}.md`, text });
    } else out.push({ type: item.type });
    if (out.length >= 2) break;
  }
  return out;
}

// How it reads in her own history afterwards.
export function actionLine(action) {
  switch (action.type) {
    case "poke":
      return `[你戳了戳${action.name || "对方"}]`;
    case "react":
      return `[你给${action.name || "那条消息"}点了「${action.emoji}」]`;
    case "dice":
      return "[你扔了个骰子]";
    case "rps":
      return "[你出了个猜拳]";
    case "recall":
      return "[你撤回了上一条]";
    case "voice":
      return "[你发了语音]";
    case "music":
      return `[你分享了歌：${action.query}]`;
    case "forward":
      return `[你转发了${action.platformIds?.length || 0}条聊天记录]`;
    case "file":
      return `[你发了文件：${action.name}]`;
    default:
      return "";
  }
}

// Runs the non-text actions; a failed one is noted and dropped, the words
// still go out.
export async function performActions(owner, message, actions, trace, session) {
  const done = [];
  if (!owner.perform) return done;
  for (const action of actions) {
    if (action.type === "reply" || action.type === "voice") continue;
    if (
      owner.actions &&
      !owner.actions.allowed(session, action.type, action.to)
    ) {
      trace.steps.push(`动作「${action.type}」这段时间做得够多了，这次不做`);
      continue;
    }
    try {
      const target =
        action.type === "recall"
          ? owner.repo.db
              .prepare(
                "SELECT platform_id FROM core_outbox WHERE session_id=? AND status='confirmed' AND platform_id<>'' AND time>=? ORDER BY time DESC LIMIT 1",
              )
              .get(session, owner.now() - 110000)?.platform_id
          : undefined;
      if (action.type === "recall" && !target) {
        trace.steps.push("想撤回，但上一条已经超过两分钟，不撤了");
        continue;
      }
      await owner.perform(message, {
        ...action,
        ...(target ? { platformId: String(target) } : {}),
        ...(action.type === "react"
          ? { emojiId: REACTIONS[action.emoji] }
          : {}),
      });
      owner.actions?.record(session, {
        type: action.type,
        target: action.to || "",
        detail: action.emoji || "",
        result: "done",
      });
      trace.steps.push(`做了动作：${actionLine(action) || action.type}`);
      done.push(action);
    } catch (error) {
      owner.actions?.record(session, {
        type: action.type,
        target: action.to || "",
        result: "failed",
      });
      trace.steps.push(`动作「${action.type}」没做成：${error.message}`);
    }
  }
  return done;
}
