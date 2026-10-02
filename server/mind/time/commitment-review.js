import { parse, text, hasCredential } from "../util.js";
import { intentRecipient, intentMessageSources } from "./intent.js";
import { spokenDate } from "./schedule.js";
const ACTION =
  /写|读|玩|看|整理|想一想|解释|分析|发|给你|做|聊|陪|提醒|联系|分享|检查/;
const FUTURE =
  /(?:我(?:会|要|想|打算|准备|答应|来)|回头|晚点|稍后|过会|等会|下次|改天|明天|后天|明晚|今晚|这周|周末|以后|到时候|等我|给你|帮你)/;
export class CommitmentReview {
  constructor(life) {
    this.life = life;
    this.time = life.mind.time;
    this.db = life.db;
  }
  batch(now) {
    const cursor = this.life.repo.config("own-day", {}).reviewSeq || 0;
    const rows = this.db
      .prepare(
        "SELECT seq,time,session_id,payload FROM core_events WHERE role='assistant' AND seq>? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND seq NOT IN (SELECT seq FROM mind_time_commitment_reviews) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND json_extract(payload,'$.artifact') IS NULL ORDER BY seq LIMIT 48",
      )
      .all(cursor, now);
    if (!rows.length) return null;
    const rooms = new Set(this.life.living().map((s) => s.id));
    const enabled = rows.filter((r) => {
      const words = String(parse(r.payload, {}).text || "");
      const candidate =
        rooms.has(r.session_id) &&
        ((FUTURE.test(words) && ACTION.test(words)) ||
          /^(?:嗯[，,]?|好|行|可以|没问题|会的|答应)/.test(words));
      if (!candidate)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO mind_time_commitment_reviews(seq,reviewed) VALUES(?,?)",
          )
          .run(r.seq, now);
      return candidate;
    });
    if (!enabled.length)
      return {
        through: rows.at(-1).seq,
        rows: [],
        session: null,
        messages: [],
      };
    const session = enabled[0].session_id,
      same = enabled.filter((r) => r.session_id === session);
    const selected = same.slice(0, 12);
    const chosen = new Set(selected.map((r) => r.seq));
    const firstOther = enabled.find((r) => !chosen.has(r.seq));
    const messages = selected.map((r) => {
      const m = parse(r.payload, {}),
        refs = Array.isArray(m.replyTargetIds) ? m.replyTargetIds : [];
      const earlier = this.db
        .prepare(
          "SELECT seq,role,payload FROM core_events WHERE session_id=? AND seq<? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 ORDER BY seq DESC LIMIT 3",
        )
        .all(session, r.seq, now)
        .reverse();
      const targets = refs
        .map((seq) =>
          this.db
            .prepare(
              "SELECT seq,role,payload FROM core_events WHERE seq=? AND session_id=? AND seq<? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND json_extract(payload,'$.artifact') IS NULL",
            )
            .get(seq, session, r.seq, now),
        )
        .filter(Boolean);
      return {
        source: `m:${r.seq}`,
        said: text(m.text, 700),
        earlier: [
          ...new Map([...earlier, ...targets].map((x) => [x.seq, x])).values(),
        ].map((x) => ({
          ref: `m:${x.seq}`,
          role: x.role,
          text: text(parse(x.payload, {}).text, 240),
        })),
      };
    });
    return {
      session,
      rows: selected,
      messages,
      through: firstOther ? firstOther.seq - 1 : rows.at(-1).seq,
    };
  }
  apply(batch, result, now) {
    if (!Array.isArray(result?.commitments)) throw Error("约定回看格式无效");
    const added = [],
      perSource = new Map();
    for (const item of result.commitments.slice(0, 6)) {
      const row = batch.rows.find((r) => `m:${r.seq}` === item.source),
        quote = text(item.quote, 240),
        title = text(item.title, 240);
      if (
        !row ||
        item.accepted !== true ||
        !quote ||
        !title ||
        hasCredential(title + quote)
      )
        continue;
      const m = parse(row.payload, {}),
        message = batch.messages.find((x) => x.source === item.source);
      if (
        !String(m.text || "").includes(quote) ||
        !ACTION.test(title) ||
        /(?:开玩笑|角色台词|小说里|故事里|假如|假设|不答应|没答应|不能答应)/.test(
          m.text,
        )
      )
        continue;
      const future = FUTURE.test(m.text) && ACTION.test(m.text);
      const accepted =
        /^(?:嗯[，,]?|好|行|可以|没问题|会的|答应)/.test(m.text) &&
        message.earlier.some(
          (e) =>
            e.role === "user" &&
            /(?:帮我|给我|能不能|你能|你可以|请你|你来)/.test(e.text) &&
            ACTION.test(e.text),
        );
      if (!future && !accepted) continue;
      if (this.time.tasks.delivery.resolve(row, m, {}, now)) continue;
      const linked = this.db
        .prepare(
          "SELECT task_id FROM mind_time_task_aliases WHERE kind='source' AND substr(alias_id,instr(alias_id,':')+1)=?",
        )
        .all(item.source)
        .map((r) =>
          this.time.tasks.get(this.time.tasks.links.canonical(r.task_id)),
        )
        .filter(Boolean);
      if (linked.length) {
        added.push(...linked.map((t) => t.id));
        perSource.set(
          row.seq,
          linked.map((t) => t.id),
        );
        continue;
      }
      if (
        !["write", "read", "think", "game", "unknown"].includes(item.activity)
      )
        continue;
      const kind = item.kind === "plan" ? "plan" : "promise",
        subject =
          kind === "promise"
            ? intentRecipient(this.db, {
                session: row.session_id,
                title: m.text,
                sources: [row.seq],
                accepted: true,
              })
            : null;
      const result = this.time.tasks.add(
        {
          kind,
          activity: item.activity,
          title,
          why: "独处回看时补回自己实际说出口的约定",
          sources: intentMessageSources(this.db, row, m),
          session: row.session_id,
          subject,
          origin: "commitment-review",
          ...spokenDate(m.text, row.time, this.time.mind.timeZone()),
        },
        now,
      );
      const id = result.id || result.duplicate;
      if (id) {
        added.push(id);
        perSource.set(row.seq, [...(perSource.get(row.seq) || []), id]);
        if (result.id && kind === "promise" && !subject)
          this.time.tasks.wait(
            this.time.tasks.get(id),
            "等待明确交付给谁",
            Number.MAX_SAFE_INTEGER,
            now,
          );
        this.time.event(
          id,
          "commitment-recovered",
          "从实际说出口的话中补回约定",
          { source: item.source, quote },
          now,
        );
      }
    }
    for (const row of batch.rows)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO mind_time_commitment_reviews(seq,reviewed,task_ids) VALUES(?,?,?)",
        )
        .run(
          row.seq,
          now,
          JSON.stringify([...new Set(perSource.get(row.seq) || [])]),
        );
    return [...new Set(added)];
  }
}
