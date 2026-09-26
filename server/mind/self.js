import { randomUUID } from "node:crypto";
import {
  CORE_THREADS,
  THREAD_FADED,
  THREAD_FADING,
  anyTouches,
  cueList,
  threadSalience,
} from "./salience.js";
import { leaks } from "./guard.js";
import { isPrivateSession } from "./memory.js";
import {
  clamp,
  dayKey,
  evidence,
  hasCredential,
  messageSeqs,
  parse,
  similar,
  text,
} from "./util.js";

export const SELF_KINDS = {
  interest: "喜欢",
  view: "看法",
  trait: "特质",
  habit: "习惯",
  intention: "想做的事",
  care: "放在心上",
  curiosity: "好奇",
};
const STEP = 0.15;
const NEW_CAP = 0.35;
const TRAIT_CAP = 0.25;

// Fade follows the last version that cited something not cited before.
// The first version counts even when it has no source.
function earnedAt(history) {
  if (!history?.length) return null;
  const seen = new Set(history[0].sources || []);
  let at = history[0].created;
  for (const row of history.slice(1)) {
    const sources = row.sources || [];
    if (sources.some((source) => !seen.has(source))) at = row.created;
    for (const source of sources) seen.add(source);
  }
  return at;
}
// Likes, questions, and a small wish of her own can begin without a message.
// Views, traits, habits, and cares still have to point at something that happened.
const SELF_ORIGINATED = new Set(["interest", "curiosity", "intention"]);

export class Self {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  revokedThreads() {
    return new Set(
      this.db
        .prepare(
          "SELECT target_id FROM mind_revocations WHERE target_kind='self'",
        )
        .all()
        .map((row) => row.target_id),
    );
  }
  revokedContents() {
    return this.db
      .prepare("SELECT content FROM mind_revocations WHERE target_kind='self'")
      .all()
      .map((row) => row.content)
      .filter(Boolean);
  }
  latest(before = Number.MAX_SAFE_INTEGER) {
    const revoked = this.revokedThreads();
    return this.db
      .prepare(
        `SELECT s.* FROM mind_self s WHERE s.rowid=(
           SELECT t.rowid FROM mind_self t WHERE t.thread=s.thread AND t.created<=?
           ORDER BY t.created DESC, t.rowid DESC LIMIT 1)`,
      )
      .all(before)
      .filter((row) => !revoked.has(row.thread))
      .map((row) => ({
        ...row,
        sources: parse(row.sources, []),
        days: parse(row.days, []),
      }));
  }
  // Every open thread with how present it is at `now`. The strongest few are
  // her core and never fall out of view.
  annotated({ before = Number.MAX_SAFE_INTEGER, now } = {}) {
    const at = now ?? (before < Number.MAX_SAFE_INTEGER ? before : Date.now());
    const lived = this.mind.days.lived(at);
    const versions = new Map();
    for (const row of this.db
      .prepare(
        "SELECT thread, created, sources FROM mind_self WHERE created<=? ORDER BY created, rowid",
      )
      .all(before)) {
      const list = versions.get(row.thread) || [];
      list.push({ created: row.created, sources: parse(row.sources, []) });
      versions.set(row.thread, list);
    }
    const rows = this.latest(before)
      .filter((row) => row.status !== "closed")
      .map((row) => ({
        ...row,
        // A rewording is not a new meeting with the thread. Fade follows the
        // last version that actually brought new evidence.
        salience: threadSalience(
          { ...row, created: earnedAt(versions.get(row.thread)) ?? row.created },
          lived,
        ),
      }));
    const core = new Set(
      [...rows]
        .sort((a, b) => b.strength - a.strength || b.created - a.created)
        .slice(0, CORE_THREADS)
        .map((row) => row.thread),
    );
    return rows
      .map((row) => ({
        ...row,
        core: core.has(row.thread),
        faded: !core.has(row.thread) && row.salience < THREAD_FADED,
      }))
      .sort((a, b) => b.salience - a.salience || b.created - a.created);
  }
  // The one wish she is living. In a room, a stronger wish that does not
  // belong there does not erase the next wish that does.
  living({ before = Number.MAX_SAFE_INTEGER, now, room } = {}) {
    const at = now ?? (before < Number.MAX_SAFE_INTEGER ? before : Date.now());
    return (
      this.annotated({ before, now: at }).find(
        (row) =>
          row.kind === "intention" &&
          !row.faded &&
          (room === undefined || this.mind.meetings.stays(row, room)),
      ) || null
    );
  }
  active({ before, limit = 40, now } = {}) {
    const ranked = this.annotated({ before, now }).filter((row) => !row.faded);
    const picked = ranked.filter((row) => row.core).slice(0, limit);
    for (const row of ranked) {
      if (picked.length >= limit) break;
      if (!row.core) picked.push(row);
    }
    return picked.sort(
      (a, b) => b.salience - a.salience || b.created - a.created,
    );
  }
  dormant({ before, now } = {}) {
    return this.annotated({ before, now }).filter((row) => row.faded);
  }
  // Faded threads that what is being said right now brings back to mind.
  reminded({ before, now, cue, cues, limit = 2 } = {}) {
    const sets = cueList(cue, cues);
    if (!sets.length) return [];
    return this.dormant({ before, now })
      .filter((row) => anyTouches(row.content, sets))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }
  // Threads slipping out of view, for her to let go of or find again.
  fading({ before, now, limit = 3 } = {}) {
    return this.annotated({ before, now })
      .filter(
        (row) =>
          !row.core && row.salience < THREAD_FADING && row.salience >= 0.04,
      )
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }
  history(thread) {
    return this.db
      .prepare("SELECT * FROM mind_self WHERE thread=? ORDER BY created")
      .all(thread)
      .map((row) => ({
        ...row,
        sources: parse(row.sources, []),
        days: parse(row.days, []),
      }));
  }
  days(sources, time) {
    const timeZone = this.mind.timeZone();
    const seqs = messageSeqs(sources);
    const found = seqs.length
      ? this.db
          .prepare(
            `SELECT time FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
          )
          .all(...seqs)
          .map((row) => dayKey(row.time, timeZone))
      : [];
    // Diary days cited in a review count as the days it happened.
    for (const ref of evidence(sources))
      if (/^d:\d{4}-\d{2}-\d{2}$/.test(ref)) found.push(ref.slice(2));
    return [...new Set(found.length ? found : [dayKey(time, timeZone)])];
  }
  propose(
    input,
    { valid = null, origin = "solitude", time = Date.now() } = {},
  ) {
    const kind = SELF_KINDS[input?.kind] ? input.kind : null;
    const content = text(input?.content, 160);
    let action = ["new", "revise", "close"].includes(input?.action)
      ? input.action
      : input?.thread
        ? "revise"
        : "new";
    if (!content && action !== "close") return { rejected: "空内容" };
    if (hasCredential(content)) return { rejected: "疑似凭据" };
    const cited = evidence(input?.sources);
    const sources = valid ? cited.filter((s) => valid.has(s)) : cited;
    if (cited.length && !sources.length)
      return { rejected: "来源不在本次经历中" };
    // Memory consolidation only records what she herself said. A wish with
    // no message is hers to form in solitude, not for the summarizer to add.
    if (origin === "memory" && !sources.length) return { rejected: "缺少来源" };
    if (
      content &&
      this.revokedContents().some((old) => similar(old, content, 0.7))
    )
      return { rejected: "与撤销过的内容相同" };
    // Faded threads count too: touching one again brings it back instead of
    // growing a second copy of it.
    const current = this.latest(time).filter((row) => row.status !== "closed");
    let prior = null;
    if (action === "new") {
      if (!kind) return { rejected: "类型无效" };
      prior = current.find(
        (row) => row.kind === kind && similar(row.content, content, 0.75),
      );
      if (prior) action = "revise";
      else if (!sources.length && !SELF_ORIGINATED.has(kind))
        return { rejected: "缺少来源" };
    } else {
      prior = this.latest(time).find((row) => row.thread === input.thread);
      if (!prior) return { rejected: "线索不存在或已撤销" };
    }
    const spent = new Set();
    if (prior)
      for (const row of this.history(prior.thread))
        for (const source of row.sources || []) spent.add(source);
    const fresh = sources.filter((source) => !spent.has(source));
    const spoken = content || prior?.content || "";
    // The same evidence cannot be spent again to make a thread stronger.
    // An unchanged sentence is not a new version. A rewording can stay,
    // at the strength the earlier evidence already earned.
    if (
      prior &&
      action !== "close" &&
      !fresh.length &&
      (spoken === prior.content || origin === "memory")
    )
      return { rejected: "没有新的经历" };
    // A revision that cites nothing new keeps the old provenance. Dropping
    // it would let a privately learned sentence travel into other rooms.
    const kept = sources.length || !prior ? sources : prior.sources || [];
    const days = [
      ...new Set([...(prior?.days || []), ...this.days(kept, time)]),
    ].slice(-60);
    let strength;
    let status;
    if (action === "close") {
      strength = prior.strength;
      status = "closed";
    } else if (prior) {
      const wanted = fresh.length
        ? Number.isFinite(Number(input?.strength))
          ? clamp(input.strength)
          : prior.strength + 0.05
        : prior.strength;
      strength = fresh.length
        ? clamp(prior.strength + clamp(wanted - prior.strength, -STEP, STEP))
        : prior.strength;
      status =
        prior.kind === "trait" && (days.length < 2 || strength < 0.35)
          ? "emerging"
          : "active";
    } else {
      strength = Math.min(
        kind === "trait" ? TRAIT_CAP : NEW_CAP,
        clamp(input?.strength ?? 0.25),
      );
      status = kind === "trait" ? "emerging" : "active";
    }
    const id = randomUUID();
    const home = this.#home(spoken, input?.session);
    this.db
      .prepare(
        "INSERT INTO mind_self(id,thread,created,kind,content,strength,status,sources,days,origin,session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        prior?.thread || id,
        time,
        prior?.kind || kind,
        spoken,
        Math.round(strength * 100) / 100,
        status,
        JSON.stringify(kept),
        JSON.stringify(days),
        origin,
        home,
      );
    return { id, thread: prior?.thread || id, action };
  }
  // Wording that matches something she learned in private stays in that room,
  // even when she did not cite a source.
  #home(content, requested) {
    const hit = leaks([content], this.mind.meetings.privateSayings())[0];
    if (hit?.session_id) return hit.session_id;
    return isPrivateSession(requested) ? requested : null;
  }
}
