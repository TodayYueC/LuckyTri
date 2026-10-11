// What happened after she chose: whether anyone answered her, how they
// sounded, whether she may have been corrected, whether someone called her
// again after she kept quiet, and how the owner tagged the reply. Read only
// from the record (events, message cues, reply feedback), never from a
// model, so it can be cleared and computed again. It is an experience to
// look back on, not a score: nothing here is summed into a reward.

const HOUR = 3600000;
export const WINDOW_MS = 2 * HOUR;
export const WINDOW_MESSAGES = 20;
// Said to her, these usually mean she got something wrong. Only a hint:
// "可能" is all it ever claims, with the message beside it.
const CORRECTION =
  /(?:^|[，,。！!？?\s])(?:你|您)?(?:不是(?:的|啦|吧)?|不对|没有啦|才不是|搞错|记错|说错|弄错|错了|并没有|不是这样)/;

const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export function migrateAftermath(addColumn) {
  // What happened next, as JSON; '' until the window has closed.
  addColumn("mind_choices", "after", "TEXT NOT NULL DEFAULT ''");
}

// The window closes at her next choice in the room, two hours after this
// one, or twenty messages later, whichever comes first. The message that
// moved her to choose again still belongs to this window.
function windowEnd(db, choice) {
  const next = db
    .prepare(
      "SELECT MIN(created) at FROM mind_choices WHERE session_id=? AND created>? ",
    )
    .get(choice.session_id, choice.created)?.at;
  return Math.min(next ?? Infinity, choice.created + WINDOW_MS);
}

// Pure read: what came after one choice, or null while the window is open.
export function aftermathOf(db, choice, now) {
  const end = windowEnd(db, choice);
  if (end === choice.created + WINDOW_MS && now < end) return null;
  const spoke = choice.choice !== "silent";
  const from = Number(choice.watermark) || 0;
  const rows = db
    .prepare(
      "SELECT seq,role,time,payload FROM core_events WHERE session_id=? AND seq>? AND time>=? AND time<=? ORDER BY seq LIMIT ?",
    )
    .all(choice.session_id, from, choice.created, end, WINDOW_MESSAGES + 10);
  // When she spoke, what others said before her words landed is not an
  // answer to them.
  const own = rows.findIndex((row) => row.role === "assistant");
  const start = spoke && own >= 0 ? own + 1 : 0;
  const after = rows
    .slice(start)
    .filter((row) => row.role !== "assistant")
    .slice(0, WINDOW_MESSAGES)
    .map((row) => ({ ...row, m: parse(row.payload) }));
  const toHer = after.filter(
    (row) => row.m.replyToBot === true || row.m.mentioned === true,
  );
  const cue = db.prepare("SELECT tone FROM core_message_cues WHERE seq=?");
  const tone = [
    ...new Set(
      toHer
        .map((row) => {
          try {
            return cue.get(row.seq)?.tone;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ];
  const corrected = spoke
    ? toHer.filter((row) => CORRECTION.test(String(row.m.text || "")))
    : [];
  // The owner's tag sits on the logged reply, whose text is what she sent.
  let feedback = [];
  if (spoke && own >= 0) {
    const sent = [];
    for (let i = own; i < rows.length && rows[i].role === "assistant"; i++)
      sent.push(String(parse(rows[i].payload).text || ""));
    try {
      feedback = db
        .prepare(
          "SELECT f.tag FROM decisions d JOIN reply_feedback f ON f.decision_id=d.id WHERE d.session_id=? AND d.reply=? AND COALESCE(d.is_demo,0)=0 ORDER BY d.id DESC LIMIT 1",
        )
        .all(choice.session_id, sent.join("\n"))
        .map((row) => row.tag);
    } catch {
      feedback = [];
    }
  }
  const first = toHer[0];
  return {
    v: 1,
    spoke,
    answered: spoke ? toHer.length > 0 : undefined,
    calledAgain: spoke ? undefined : toHer.length > 0,
    toHer: toHer.length,
    others: after.length,
    firstMin: first
      ? Math.max(0, Math.round((first.time - choice.created) / 60000))
      : null,
    ...(tone.length ? { tone } : {}),
    ...(corrected.length ? { corrected: "maybe" } : {}),
    ...(feedback.length ? { feedback: [...new Set(feedback)] } : {}),
    ...(spoke && own >= 0 ? { own: `m:${rows[own].seq}` } : {}),
    refs: [...corrected, ...toHer.filter((row) => !corrected.includes(row))]
      .slice(0, 4)
      .map((row) => `m:${row.seq}`),
  };
}

// Writes what came after for choices whose window has closed, oldest first,
// a page at a time. Returns how many were written.
export function settleAftermath(db, { now, limit = 50 } = {}) {
  const rows = db
    .prepare(
      `SELECT c.id,c.created,c.session_id,c.choice,c.watermark FROM mind_choices c
       WHERE c.after='' AND (c.created<=? OR EXISTS (SELECT 1 FROM mind_choices n WHERE n.session_id=c.session_id AND n.created>c.created))
       ORDER BY c.created LIMIT ?`,
    )
    .all(now - WINDOW_MS, limit);
  if (!rows.length) return 0;
  const write = db.prepare(
    "UPDATE mind_choices SET after=? WHERE id=? AND after=''",
  );
  let written = 0;
  db.exec("SAVEPOINT aftermath");
  try {
    for (const row of rows) {
      const after = aftermathOf(db, row, now);
      if (after) written += write.run(JSON.stringify(after), row.id).changes;
    }
    db.exec("RELEASE aftermath");
  } catch (error) {
    db.exec("ROLLBACK TO aftermath");
    db.exec("RELEASE aftermath");
    throw error;
  }
  return written;
}

// How the record reads back in a line, for her and for the audit.
export function describeAftermath(after) {
  if (!after || typeof after !== "object") return "";
  const parts = [];
  if (after.spoke) {
    parts.push(
      after.answered
        ? `有人接了我的话${after.firstMin != null ? `（${after.firstMin} 分钟后）` : ""}`
        : after.others
          ? "没人接我的话，大家接着聊别的"
          : "说完以后没人再说话",
    );
    if (after.corrected) parts.push("可能说错了，被纠正");
  } else {
    parts.push(after.calledAgain ? "我没出声，之后又有人叫我" : "我没出声");
  }
  if (after.tone?.length) parts.push(`对方的语气：${after.tone.join("、")}`);
  if (after.feedback?.length)
    parts.push(`主人的反馈：${after.feedback.join("、")}`);
  return parts.join("；");
}
