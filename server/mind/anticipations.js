import { randomUUID } from "node:crypto";
import { localClock } from "../core/conversation-cues.js";
import { hasCredential } from "./guard.js";
import { isPrivateSession } from "./memory.js";
import { DAY, evidence, parse, similar, text, zonedTime } from "./util.js";

// What she is looking ahead to: promises she made, things she means to do,
// what others told her is coming, and the dates that come back every year.
export const ANTICIPATION_KINDS = {
  promise: "答应的事",
  plan: "想做的事",
  event: "别人的安排",
  date: "每年的日子",
};
// How long after its day something still waits to be asked about or done
// before it quietly counts as missed.
const GRACE = { event: 3 * DAY, promise: 7 * DAY, plan: 7 * DAY, date: 0 };
const HORIZON = 400 * DAY;
const CLOSE = new Set(["done", "missed", "let_go"]);

function row(value) {
  return value
    ? {
        ...value,
        sources: parse(value.sources, []),
        closed_sources: parse(value.closed_sources, []),
      }
    : null;
}

export class Anticipations {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  day(time) {
    return localClock(time, this.mind.timeZone()).local.slice(0, 10);
  }
  // A yearly date's next return (or today's), otherwise the one due moment.
  occurrence(a, now) {
    if (a.recurrence !== "yearly") return a.due_at;
    const monthDay = this.day(a.due_at).slice(5);
    const year = Number(this.day(now).slice(0, 4));
    for (const y of [year - 1, year, year + 1]) {
      const at = zonedTime(`${y}-${monthDay}`, this.mind.timeZone());
      if (at !== null && at + DAY > now) return at;
    }
    return a.due_at;
  }
  ends(a, due) {
    return due + (a.due_precision === "time" ? 0 : DAY);
  }
  // From the start of the day before.
  opens(due) {
    const midnight = zonedTime(this.day(due), this.mind.timeZone());
    return (midnight ?? due) - DAY;
  }
  // Her name for someone, or the name they last used where it was said.
  who(a) {
    if (!a.subject) return "";
    const known = this.mind.bonds.name(a.subject);
    if (known) return known;
    const said = parse(
      this.db
        .prepare(
          "SELECT payload FROM core_events WHERE session_id=? AND role='user' AND json_extract(payload,'$.userId')=? ORDER BY seq DESC LIMIT 1",
        )
        .get(a.session_id, String(a.subject))?.payload,
      {},
    );
    return said.name || a.subject;
  }
  lapsed(a, now) {
    return (
      a.recurrence !== "yearly" &&
      now > this.ends(a, a.due_at) + (GRACE[a.kind] ?? GRACE.event)
    );
  }
  revokedContents() {
    return this.db
      .prepare(
        "SELECT content FROM mind_revocations WHERE target_kind='anticipation'",
      )
      .all()
      .map((r) => r.content)
      .filter(Boolean);
  }
  add({
    kind,
    subject = null,
    session = null,
    content,
    due,
    recurrence = "none",
    discretion = "open",
    sources = [],
    origin = "memory",
    time = Date.now(),
  }) {
    if (!ANTICIPATION_KINDS[kind]) return { rejected: "类型无效" };
    const words = text(content, 120);
    if (!words || hasCredential(words)) return { rejected: "内容无效" };
    const refs = evidence(sources);
    if (!refs.length) return { rejected: "缺少来源" };
    const when = String(due ?? "").trim();
    const at = zonedTime(when, this.mind.timeZone());
    if (at === null) return { rejected: "日期无效" };
    const yearly = kind === "date" || recurrence === "yearly";
    const precision = /\d{2}:\d{2}$/.test(when) ? "time" : "day";
    if (
      !yearly &&
      (this.ends({ due_precision: precision }, at) <= time - DAY ||
        at > time + HORIZON)
    )
      return { rejected: "日期不在合理范围" };
    const who = subject ? String(subject) : "";
    if (
      this.revokedContents().some((old) =>
        similar(old, `${who}\n${words}`, 0.75),
      )
    )
      return { rejected: "与撤销过的内容相同" };
    const key = yearly ? this.day(at).slice(5) : this.day(at);
    const same = this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE status='pending' AND COALESCE(subject,'')=? AND kind=?",
      )
      .all(who, kind)
      .find(
        (r) =>
          (yearly ? this.day(r.due_at).slice(5) : this.day(r.due_at)) === key &&
          similar(r.content, words, 0.6),
      );
    if (same) return { duplicate: same.id };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_anticipations(id,created,kind,subject,session_id,content,due_at,due_precision,recurrence,discretion,sources,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        time,
        kind,
        who || null,
        session,
        words,
        at,
        precision,
        yearly ? "yearly" : "none",
        ["open", "private", "secret"].includes(discretion)
          ? discretion
          : "open",
        JSON.stringify(refs),
        origin,
      );
    return { id };
  }
  get(id) {
    return row(
      this.db.prepare("SELECT * FROM mind_anticipations WHERE id=?").get(id),
    );
  }
  // Still open at `now`; something closed later still counts when looking back.
  pending(now = Date.now()) {
    return this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE created<=? AND (status='pending' OR (closed_at IS NOT NULL AND closed_at>? AND status!='revoked')) ORDER BY due_at",
      )
      .all(now, now)
      .map(row);
  }
  close(id, { status, note = "", sources = [], time = Date.now() } = {}) {
    if (!CLOSE.has(status)) return false;
    const a = this.get(id);
    if (!a || a.status !== "pending" || a.recurrence === "yearly") return false;
    return (
      this.db
        .prepare(
          "UPDATE mind_anticipations SET status=?,closed_at=?,closed_note=?,closed_sources=? WHERE id=? AND status='pending'",
        )
        .run(
          status,
          time,
          text(note, 120),
          JSON.stringify(evidence(sources)),
          id,
        ).changes > 0
    );
  }
  revoke(id, reason = "") {
    const a = this.get(id);
    if (!a) throw Error("约定不存在");
    this.db
      .prepare(
        "UPDATE mind_anticipations SET status='revoked',closed_at=?,closed_note=? WHERE id=?",
      )
      .run(Date.now(), text(reason, 120), id);
    return `${a.subject || ""}\n${a.content}`;
  }
  relative(due, now, precision = "day") {
    const zone = this.mind.timeZone();
    const at = (t) =>
      Date.parse(`${localClock(t, zone).local.slice(0, 10)}T00:00:00Z`);
    const days = Math.round((at(due) - at(now)) / DAY);
    const clock =
      precision === "time" ? ` ${localClock(due, zone).local.slice(11)}` : "";
    const named = {
      0: "今天",
      1: "明天",
      2: "后天",
      [-1]: "昨天",
      [-2]: "前天",
    };
    if (named[days] !== undefined) return named[days] + clock;
    return days > 0 ? `${days} 天后` : `${-days} 天前`;
  }
  label(a, due, now) {
    const who = this.who(a);
    const when = this.relative(due, now, a.due_precision);
    if (a.kind === "promise")
      return `我答应${who ? `${who}` : ""}：${a.content}（${when}${a.status === "pending" ? "，还没做" : ""}）`;
    if (a.kind === "plan") return `我打算：${a.content}（${when}）`;
    return `${who ? `${who}：` : ""}${a.content}（${when}）`;
  }
  // Near enough to matter in a conversation: from the day before until a few
  // days after, and only where it belongs.
  upcoming({ now = Date.now(), people = [], session = "", limit = 3 } = {}) {
    const here = new Set(session ? this.mind.memory.scopes(session) : []);
    const present = new Set(people.map(String));
    const out = [];
    for (const a of this.pending(now)) {
      const due = this.occurrence(a, now);
      const after =
        a.recurrence === "yearly" ? 0 : (GRACE[a.kind] ?? GRACE.event);
      if (now < this.opens(due) || now >= this.ends(a, due) + after) continue;
      const relevant =
        (a.subject && present.has(String(a.subject))) ||
        a.session_id === session ||
        (a.kind === "plan" && !a.subject);
      if (!relevant) continue;
      const local = here.has(a.session_id);
      if (a.discretion !== "open" && !local) continue;
      out.push({ id: a.id, due, text: this.label(a, due, now) });
      if (out.length >= limit) break;
    }
    return out;
  }
  // What she might think about when alone: due soon, just past, or quietly
  // missed within the last week.
  due({ now = Date.now(), limit = 5 } = {}) {
    const out = [];
    for (const a of this.pending(now)) {
      const due = this.occurrence(a, now);
      const after =
        a.recurrence === "yearly"
          ? 0
          : (GRACE[a.kind] ?? GRACE.event) + 7 * DAY;
      if (now < this.opens(due) || now >= this.ends(a, due) + after) continue;
      out.push({
        ref: `a:${a.id}`,
        kind: ANTICIPATION_KINDS[a.kind],
        ...(a.subject ? { who: this.who(a), userId: a.subject } : {}),
        content: a.content,
        when: this.relative(due, now, a.due_precision),
        ...(this.lapsed(a, now) ? { lapsed: true } : {}),
        ...(a.recurrence === "yearly" ? { yearly: true } : {}),
      });
      if (out.length >= limit) break;
    }
    return out;
  }
  // Something she was looking ahead to has come close, or just passed.
  newlyDue(since, now = Date.now()) {
    return this.pending(now).some((a) => {
      const due = this.occurrence(a, now);
      const edges = [this.opens(due), this.ends(a, due)];
      return edges.some((edge) => edge > since && edge <= now);
    });
  }
  // The day's promises kept and missed, and the dates that fall on it.
  today({ start, end }) {
    const closed = this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE closed_at>=? AND closed_at<? AND status IN ('done','missed','let_go') ORDER BY closed_at",
      )
      .all(start, end)
      .map(row);
    const lapsedToday = this.pending(end).filter((a) => {
      if (a.recurrence === "yearly") return false;
      const at = this.ends(a, a.due_at) + (GRACE[a.kind] ?? GRACE.event);
      return at >= start && at < end;
    });
    const line = (a) => this.label(a, this.occurrence(a, start), start);
    const byStatus = (status) =>
      closed.filter((a) => a.status === status).map(line);
    return {
      kept: byStatus("done"),
      missed: [...byStatus("missed"), ...lapsedToday.map(line)],
      letGo: byStatus("let_go"),
      dates: this.pending(end)
        .filter(
          (a) =>
            a.recurrence === "yearly" &&
            this.day(this.occurrence(a, start)) === this.day(start),
        )
        .map(line),
      dueToday: this.pending(end)
        .filter(
          (a) =>
            a.recurrence !== "yearly" && a.due_at >= start && a.due_at < end,
        )
        .map(line),
    };
  }
  list({ now = Date.now(), limit = 100 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_anticipations ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, due_at LIMIT ?",
      )
      .all(limit)
      .map(row)
      .map((a) => {
        const due = this.occurrence(a, now);
        return {
          ...a,
          name: this.who(a),
          occurrence: due,
          when: this.relative(due, now, a.due_precision),
          state:
            a.status === "pending" && this.lapsed(a, now) ? "lapsed" : a.status,
          private: a.discretion !== "open" || isPrivateSession(a.session_id),
        };
      });
  }
}
