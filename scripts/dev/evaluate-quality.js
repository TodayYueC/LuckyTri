// Runs the quality set against the code in this checkout, one fresh
// in-memory world per scene. History, her own earlier replies and remembered
// facts are written straight into the store, so every checkout sees the same
// past; only the final turn goes through the real reply pipeline. Spends
// tokens: the key comes only from the environment (LLM_API_KEY,
// EMBEDDING_API_KEY). One JSON file per scene, so a run can be resumed and
// split across processes:
//
//   node scripts/dev/evaluate-quality.js --arm botrina --out <目录> [--set life-v1] [--shard 1/4] [--only A1,B2]
//
// life-v1 scenes also seed other chats, her own views (citing the line where
// she said them), a lingering mood, things she is waiting for and bound bots,
// all through the project's own interfaces. Anything those interfaces refuse
// is recorded in result.seeding.rejected instead of being forced in.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { liveWorld, spend } from "./live-world.js";
import { persistReply } from "../../server/core/message-manager.js";
import { loadSet } from "./quality-sets.js";
import { objective } from "./quality-checks.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const arm = option("--arm", "current");
const out = resolve(option("--out", "data/evaluations/quality"), arm);
const only = option("--only", "")?.split(",").filter(Boolean) || [];
const [shard, shards] = option("--shard", "1/1").split("/").map(Number);
// --sample 2 writes <id>~2.json: an extra draw for the objective majority.
const sample = Number(option("--sample", "1"));
// --dump-input keeps the data each model stage was given, to check what
// she actually saw (e.g. whether a private memory reached a group turn).
const dumpInput = args.includes("--dump-input");
// --mood 烦:0.8:-0.6:被放鸽子:30[:arousal] replaces each scene's mood, so the same
// scene can be replayed under different feelings (feeling:intensity:valence
// [:cause[:minutesBefore]]).
const moodOverride = (() => {
  const raw = option("--mood", "");
  if (!raw) return null;
  const [feeling, intensity, valence, cause = "", before = "30", arousal] =
    raw.split(":");
  return {
    feeling,
    intensity: Number(intensity),
    valence: Number(valence),
    cause,
    minutesBefore: Number(before),
    ...(arousal ? { arousal: Number(arousal) } : {}),
  };
})();
const MIN = 60000;
const { scenes, person, VERSION } = await loadSet(
  option("--set", "quality-v1"),
);

async function run(scene) {
  const w = await liveWorld({ start: scene.start });
  const name = w.system.repo.store.settings().name;
  const fill = (text) => String(text).replaceAll("{name}", name);
  const session =
    scene.kind === "group" ? "group:1" : `private:${person(scene.with)[0]}`;
  w.open(session, scene.kind === "group" ? "朋友群" : scene.with);
  const now = w.now();
  const at = (minutes) => now - minutes * MIN;
  const rejected = [];
  // "group" and "private:<名字>" name chats in the scene; nothing means here.
  const chat = (spec) => {
    if (!spec) return session;
    if (spec === "group") return "group:1";
    const m = /^private:(.+)$/.exec(spec);
    return m ? `private:${person(m[1])[0]}` : spec;
  };
  const opened = new Set([session]);
  const open = (where, title) => {
    if (opened.has(where)) return;
    opened.add(where);
    w.open(where, where === "group:1" ? "朋友群" : title || where);
  };
  for (const r of scene.relationships || []) {
    const [uid, who] = person(r.who);
    w.mind.relationships.save(
      {
        subjectId: uid,
        name: who,
        kind: r.kind || "human",
        peerRole: r.peerRole || "朋友",
        note: r.note || "",
      },
      at(r.minutesBefore ?? 30 * 24 * 60),
    );
  }
  // Every seeded line, so her views can cite what she actually said.
  let lastSeq = null;
  const append = w.system.repo.append.bind(w.system.repo);
  w.system.repo.append = (m) => (lastSeq = append(m));
  let seeded = 0;
  const writeLines = (where, kind, lines) => {
    const seqs = new Map();
    lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => b.line[0] - a.line[0])
      .forEach(({ line: [minutes, who, text, extra = {}], index }) => {
        if (who === "me")
          persistReply(
            w.system.repo,
            { sessionId: where, kind, accountId: "99999" },
            fill(text),
            `seed-${++seeded}`,
            at(minutes),
          );
        else {
          const [uid, nick] = person(who);
          w.say(where, uid, fill(text), {
            name: nick,
            time: at(minutes),
            ...(extra.mention ? { mentioned: true } : {}),
          });
        }
        seqs.set(index, { seq: lastSeq, who, minutes });
      });
    return seqs;
  };
  const ids = [];
  const saidSeqs = [];
  for (const m of scene.memories || []) {
    const where = chat(m.session);
    open(where, m.session);
    const [uid, who] = person(m.who);
    let source = null;
    const [saidUid, saidWho] = m.saidBy ? person(m.saidBy[0]) : [uid, who];
    const saidText = m.saidBy ? m.saidBy[1] : m.said;
    if (saidText) {
      const e = w.say(where, saidUid, fill(saidText), {
        name: saidWho,
        time: at(m.minutesBefore),
      });
      saidSeqs.push({ who: m.who, seq: e.seq });
      source = {
        id: e.seq,
        text: saidText,
        speaker: saidUid,
        certainty: saidUid === uid ? "self_report" : "reported",
      };
    }
    ids.push(
      w.mind.memory.insert({
        session: where,
        subject: uid,
        content: m.content,
        type: "event",
        confidence: 0.9,
        importance: 0.6,
        discretion: m.discretion || "open",
        sources: source ? [source] : [],
        time: at(m.minutesBefore),
      }),
    );
  }
  for (const [i, j] of scene.conflicts || [])
    w.store.db
      .prepare(
        "INSERT OR IGNORE INTO mind_links(from_id,to_id,relation,created,sources) VALUES (?,?,'conflicts',?,?)",
      )
      .run(`fact:${ids[j]}`, `fact:${ids[i]}`, now, "[]");
  for (const other of scene.otherSessions || []) {
    const where = chat(
      other.kind === "group" ? "group" : `private:${other.with}`,
    );
    open(where, other.with);
    writeLines(
      where,
      other.kind === "group" ? "group" : "private",
      other.history || [],
    );
  }
  const lines = writeLines(session, scene.kind, scene.history || []);
  for (const v of scene.self || []) {
    const line = lines.get(v.fromLine);
    const cited = line?.who === "me" ? line : null;
    const r = w.mind.self.propose(
      { kind: v.kind, content: v.content, sources: cited ? [cited.seq] : [] },
      { origin: "solitude", time: cited ? at(cited.minutes) + 1000 : at(60) },
    );
    if (r?.rejected) rejected.push({ self: v.content, reason: r.rejected });
  }
  if (moodOverride) scene = { ...scene, mood: moodOverride };
  if (scene.mood) {
    const r = w.mind.affect.feel({
      feeling: scene.mood.feeling,
      intensity: scene.mood.intensity,
      valence: scene.mood.valence,
      arousal: scene.mood.arousal,
      cause: scene.mood.cause || "",
      session,
      time: at(scene.mood.minutesBefore ?? 60),
    });
    if (!r) rejected.push({ mood: scene.mood.feeling, reason: "未记录" });
  }
  for (const a of scene.anticipations || []) {
    const [uid] = person(a.who);
    // Cite the newest line from that person; a wait needs its source.
    const from = [...lines.values()]
      .filter((l) => l.who === a.who)
      .sort((x, y) => x.minutes - y.minutes)[0];
    const said = saidSeqs.find((s) => s.who === a.who);
    const source = from?.seq || said?.seq;
    const r = w.mind.anticipations.add({
      kind: a.kind,
      subject: uid,
      session,
      content: a.content,
      due: a.due,
      sources: source ? [source] : [],
      origin: "memory",
      time: from ? at(from.minutes) + 1000 : at(60),
    });
    if (r?.rejected)
      rejected.push({ anticipation: a.content, reason: r.rejected });
  }
  w.system.repo.append = append;
  await w.mind.recall.prepare(now);
  const events = scene.final.map(([who, text, extra = {}], i, all) => {
    const [uid, nick] = person(who);
    return w.say(session, uid, fill(text), {
      name: nick,
      time: now - (all.length - 1 - i) * 5000,
      ...(extra.mention ? { mentioned: true } : {}),
    });
  });
  const inputs = [];
  if (dumpInput) {
    const call = w.system.models.call.bind(w.system.models);
    w.system.models.call = (profile, stage, system, data, ...rest) => {
      inputs.push({ stage, data });
      return call(profile, stage, system, data, ...rest);
    };
  }
  const before = w.requests.length;
  const started = Date.now();
  let error = null;
  try {
    await w.hear(session, events);
  } catch (e) {
    error = String(e?.message || e).slice(0, 200);
  }
  const wallMs = Date.now() - started;
  const bubbles = w.sent.map((s) => s.text);
  const reply = bubbles.join(" / ");
  const trace = w
    .traces()
    .findLast((t) => t.sessionId === session && t.mode === "live");
  const decision = trace?.decision || {};
  const seqs = events.map((e) => e.seq);
  const targets = (decision.targetMessageIds || [])
    .map((id) => seqs.indexOf(Number(id)))
    .filter((i) => i >= 0);
  const calls = (trace?.calls || []).map((c) => ({
    stage: c.stage,
    elapsed: c.elapsed,
    requestBytes: c.requestBytes || 0,
    tokens: c.tokens || null,
    error: c.error || undefined,
  }));
  const result = {
    ...(dumpInput ? { inputs } : {}),
    version: VERSION,
    arm,
    id: scene.id,
    cat: scene.cat,
    reply,
    bubbles,
    silent: !reply,
    choice: decision.choice || "",
    targets,
    wallMs,
    error,
    revisions: trace?.revisions || [],
    // How often the reader check let a reply through that reached the main
    // meaning but not every side point (it would have been rewritten before).
    readerPassed: (trace?.steps || []).filter((step) =>
      String(step).startsWith("读者核对：主要意思已接到"),
    ),
    calls,
    prompt: w.requests
      .slice(before)
      .filter((r) => r.path !== "/embeddings")
      .map((r) => ({ systemChars: r.systemChars, promptChars: r.promptChars })),
    spend: spend(w.requests.slice(before)),
    seedSpend: spend(w.requests.slice(0, before)),
    seeding: { rejected },
  };
  result.checks = objective(scene, result);
  w.close();
  return result;
}

mkdirSync(out, { recursive: true });
const list = scenes.filter(
  (s, i) =>
    (only.length ? only.includes(s.id) : true) && (i % shards) + 1 === shard,
);
for (const scene of list) {
  const file = join(
    out,
    sample > 1 ? `${scene.id}~${sample}.json` : `${scene.id}.json`,
  );
  if (existsSync(file)) continue;
  // Seeding embeds every line; a rate-limited provider gets a few patient
  // retries of the whole scene rather than a half-seeded world.
  let result = null;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await run(scene);
      // A turn lost to the network is not her choice to stay quiet; it says
      // nothing about her, so the scene is drawn again (at most twice).
      if (
        attempt <= 2 &&
        result.calls?.some((c) => c.stage === "turn" && c.error)
      ) {
        console.error(
          `${scene.id}\t网络失败，重跑：${result.calls.find((c) => c.error).error.slice(0, 60)}`,
        );
        result = null;
        continue;
      }
    } catch (e) {
      if (attempt >= 8) throw e;
      console.error(
        `${scene.id}\t重试 ${attempt}: ${String(e?.message || e).slice(0, 80)}`,
      );
      await new Promise((r) =>
        setTimeout(r, Math.min(120000, 30000 * attempt)),
      );
    }
  }
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(
    `${scene.id}\t${result.wallMs}ms\t${result.spend.requests}req\t${result.checks.passed}/${result.checks.total}\t${result.reply.slice(0, 60)}`,
  );
}
