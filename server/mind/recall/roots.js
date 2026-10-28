import { interestTerms } from "../attention.js";
import { evidenceRoots } from "../evidence.js";
import { SELF_KINDS } from "../self.js";
import { parse, text } from "../util.js";
import { fixedReplyHabit } from "../../core/conversation-grounding.js";

// What each of her records ultimately rests on: the messages, observations
// and finished work its sources resolve to. Derived from the sources she
// already keeps, so it can be dropped and refilled at any time; it asserts
// nothing new. Two records that rest on the same moment belong together.
const KINDS = {
  episode: {
    pending: (
      from,
    ) => `SELECT id ref, created stamp, sources FROM ${from("mind_episodes")} e
      WHERE NOT EXISTS (SELECT 1 FROM mind_rooted r WHERE r.item_id='episode:'||e.id) LIMIT ?`,
    roots: (db, row) => evidenceRoots(db, parse(row.sources, [])),
  },
  thought: {
    pending: (
      from,
    ) => `SELECT id ref, created*2+hidden stamp FROM ${from("mind_thoughts")} t
      WHERE NOT EXISTS (SELECT 1 FROM mind_rooted r WHERE r.item_id='thought:'||t.id AND r.stamp=t.created*2+t.hidden) LIMIT ?`,
    roots: (db, row) => evidenceRoots(db, [`t:${row.ref}`]),
  },
  anticipation: {
    pending: (
      from,
    ) => `SELECT id ref, created stamp FROM ${from("mind_anticipations")} a
      WHERE NOT EXISTS (SELECT 1 FROM mind_rooted r WHERE r.item_id='anticipation:'||a.id) LIMIT ?`,
    roots: (db, row) => evidenceRoots(db, [`a:${row.ref}`]),
  },
  // A self thread grows new versions and a note or thread may be taken
  // back; either changes the stamp (time doubled, plus one once revoked),
  // so it is looked at again.
  self: {
    pending: (
      from,
    ) => `SELECT ref, stamp FROM (SELECT thread ref, MAX(created)*2+EXISTS(SELECT 1 FROM mind_revocations v WHERE v.target_kind='self' AND v.target_id=thread) stamp FROM mind_self WHERE thread IN (SELECT thread FROM ${from("mind_self")} y) GROUP BY thread) x
      WHERE NOT EXISTS (SELECT 1 FROM mind_rooted r WHERE r.item_id='self:'||x.ref AND r.stamp=x.stamp) LIMIT ?`,
    roots: (db, row) => evidenceRoots(db, [`s:${row.ref}`]),
  },
};

export function migrateRoots(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mind_roots(
      item_id TEXT NOT NULL,
      root TEXT NOT NULL,
      PRIMARY KEY(item_id,root)
    );
    CREATE INDEX IF NOT EXISTS mind_roots_root ON mind_roots(root);
    CREATE TABLE IF NOT EXISTS mind_rooted(
      item_id TEXT PRIMARY KEY,
      stamp INTEGER NOT NULL
    );
  `);
}

// Works through records not yet looked at, a page at a time. Idempotent.
// `recent` only looks among the newest rows of each table, cheap enough for
// a turn; the background pass looks at everything.
export function fillRoots(db, limit = 500, { recent = 0 } = {}) {
  const from = (table) =>
    recent
      ? `(SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ${Math.floor(recent)})`
      : table;
  let done = 0;
  const clear = db.prepare("DELETE FROM mind_roots WHERE item_id=?");
  const put = db.prepare(
    "INSERT OR IGNORE INTO mind_roots(item_id,root) VALUES (?,?)",
  );
  const mark = db.prepare(
    "INSERT INTO mind_rooted(item_id,stamp) VALUES (?,?) ON CONFLICT(item_id) DO UPDATE SET stamp=excluded.stamp",
  );
  db.exec("SAVEPOINT mind_roots_fill");
  try {
    for (const [kind, spec] of Object.entries(KINDS)) {
      if (done >= limit) break;
      for (const row of db.prepare(spec.pending(from)).all(limit - done)) {
        const id = `${kind}:${row.ref}`;
        clear.run(id);
        for (const root of spec.roots(db, row)) put.run(id, root);
        mark.run(id, row.stamp);
        done++;
      }
    }
    db.exec("RELEASE mind_roots_fill");
  } catch (error) {
    db.exec("ROLLBACK TO mind_roots_fill");
    db.exec("RELEASE mind_roots_fill");
    throw error;
  }
  return done;
}

const LINE = 60;
const ANTICIPATION_STATE = {
  pending: "还没做",
  done: "做了",
  missed: "没做成",
  let_go: "放下了",
};

// Her own notes, intentions and self threads that rest on the same moments
// as an affair, and that speak of it (two shared words, one from its title,
// or close in meaning when both have vectors). At most two short lines: the first and the latest of a
// revised note ("当时想 / 后来想"), then an intention of hers, then a self
// thread. Records already in front of her are left out. Each line carries
// the index id it came from, for the record of what came to mind.
export function mineFor(
  mind,
  steps,
  { session, now = Date.now(), exclude = new Set(), close = () => false } = {},
) {
  const db = mind.db;
  const ids = steps.map((s) => `episode:${s.id}`);
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  const linked = db
    .prepare(
      `SELECT DISTINCT b.item_id id FROM mind_roots a JOIN mind_roots b ON b.root=a.root
       WHERE a.item_id IN (${marks}) AND a.root NOT LIKE 's:%'
       AND (b.item_id LIKE 'thought:%' OR b.item_id LIKE 'anticipation:%' OR b.item_id LIKE 'self:%')`,
    )
    .all(...ids)
    .map((r) => r.id)
    .filter((id) => !exclude.has(id));
  if (!linked.length) return [];
  const terms = interestTerms(
    steps.map((s) => [s.title, s.content, s.outcome].join(" ")),
  );
  // One shared pair is too easy to come by ("最近", "晚上"); it counts only
  // when it is in the affair's own title. Otherwise two, or close meaning.
  const titled = interestTerms(steps.map((s) => s.title));
  const speaks = (id, words) => {
    const shared = [...interestTerms([words])].filter((t) => terms.has(t));
    return (
      shared.length >= 2 || shared.some((t) => titled.has(t)) || close(id, ids)
    );
  };
  const fits = (words) =>
    words && !fixedReplyHabit(words) && mind.meetings.sayable(words, session);
  const lines = [];
  // Notes: one revision chain at a time, told by its first and latest step.
  const notes = new Map();
  for (const id of linked.filter((x) => x.startsWith("thought:"))) {
    const row = db
      .prepare(
        "SELECT * FROM mind_thoughts WHERE id=? AND hidden=0 AND created<=?",
      )
      .get(id.slice(8), now);
    if (!row) continue;
    const sessions = parse(row.sessions, []);
    const allowedInSession = sessions.length
      ? sessions.includes(session)
      : mind.meetings.stays(
          {
            ...row,
            sources: parse(row.sources, []),
            session_id: "",
          },
          session,
          now,
        );
    if (!allowedInSession) continue;
    if (!fits(row.content) || !speaks(id, row.content)) continue;
    notes.set(row.id, row);
  }
  const chainOf = (row) => {
    let head = row;
    for (let seen = 0; head.parent_id && seen < 20; seen++) {
      const up = db
        .prepare("SELECT * FROM mind_thoughts WHERE id=? AND hidden=0")
        .get(head.parent_id);
      if (!up) break;
      head = up;
    }
    let last = head;
    for (let seen = 0; seen < 20; seen++) {
      const down = db
        .prepare(
          "SELECT * FROM mind_thoughts WHERE parent_id=? AND hidden=0 AND created<=? ORDER BY created DESC LIMIT 1",
        )
        .get(last.id, now);
      if (!down) break;
      last = down;
    }
    return { head, last };
  };
  const chains = new Map();
  for (const row of [...notes.values()].sort((a, b) => a.created - b.created)) {
    const { head, last } = chainOf(row);
    if (!chains.has(head.id)) chains.set(head.id, { head, last });
  }
  for (const { head, last } of chains.values()) {
    if (lines.length >= 2) break;
    if (exclude.has(`thought:${head.id}`)) continue;
    lines.push({
      id: `thought:${head.id}`,
      text: `当时想：${text(head.content, LINE)}`,
    });
    if (
      last.id !== head.id &&
      lines.length < 2 &&
      !exclude.has(`thought:${last.id}`) &&
      fits(last.content)
    )
      lines.push({
        id: `thought:${last.id}`,
        text: `后来想：${text(last.content, LINE)}`,
      });
  }
  // Her own intentions about it.
  for (const id of linked.filter((x) => x.startsWith("anticipation:"))) {
    if (lines.length >= 2) break;
    const row = db
      .prepare(
        `SELECT * FROM mind_anticipations WHERE id=? AND created<=? AND kind IN ('promise','plan')
         AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='anticipation')`,
      )
      .get(id.slice(13), now);
    if (!row || (row.discretion !== "open" && row.session_id !== session))
      continue;
    if (!fits(row.content) || !speaks(id, row.content)) continue;
    lines.push({
      id,
      text: `我打算过：${text(row.content, LINE)}（${ANTICIPATION_STATE[row.status] || row.status}）`,
    });
  }
  // A self thread that grew from it and is not already in view.
  for (const id of linked.filter((x) => x.startsWith("self:"))) {
    if (lines.length >= 2) break;
    const row = mind.self
      .latest(now)
      .find((t) => t.thread === id.slice(5) && t.status !== "closed");
    if (!row || !fits(row.content) || !speaks(id, row.content)) continue;
    lines.push({
      id,
      text: `${SELF_KINDS[row.kind] || "自己"}：${text(row.content, LINE)}`,
    });
  }
  return lines.slice(0, 2);
}
