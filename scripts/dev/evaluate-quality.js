// Runs the quality set against the code in this checkout, one fresh
// in-memory world per scene. History, her own earlier replies and remembered
// facts are written straight into the store, so every checkout sees the same
// past; only the final turn goes through the real reply pipeline. Spends
// tokens: the key comes only from the environment (LLM_API_KEY,
// EMBEDDING_API_KEY). One JSON file per scene, so a run can be resumed and
// split across processes:
//
//   node scripts/dev/evaluate-quality.js --arm botrina --out <目录> [--shard 1/4] [--only A1,B2]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { liveWorld, spend } from "./live-world.js";
import { persistReply } from "../../server/core/message-manager.js";
import { scenes, person, VERSION } from "./quality-set/v1.js";
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
const MIN = 60000;

async function run(scene) {
  const w = await liveWorld({ start: scene.start });
  const name = w.system.repo.store.settings().name;
  const fill = (text) => String(text).replaceAll("{name}", name);
  const session =
    scene.kind === "group" ? "group:1" : `private:${person(scene.with)[0]}`;
  w.open(session, scene.kind === "group" ? "朋友群" : scene.with);
  const now = w.now();
  const at = (minutes) => now - minutes * MIN;
  const ids = [];
  for (const m of scene.memories || []) {
    const where = !m.session || m.session === "group" ? session : m.session;
    if (where !== session) w.open(where, where);
    const [uid, who] = person(m.who);
    let source = null;
    const [saidUid, saidWho] = m.saidBy ? person(m.saidBy[0]) : [uid, who];
    const saidText = m.saidBy ? m.saidBy[1] : m.said;
    if (saidText) {
      const e = w.say(where, saidUid, saidText, {
        name: saidWho,
        time: at(m.minutesBefore),
      });
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
  let seeded = 0;
  for (const [minutes, who, text, extra = {}] of [
    ...(scene.history || []),
  ].sort((a, b) => b[0] - a[0])) {
    if (who === "me")
      persistReply(
        w.system.repo,
        { sessionId: session, kind: scene.kind, accountId: "99999" },
        fill(text),
        `seed-${++seeded}`,
        at(minutes),
      );
    else {
      const [uid, nick] = person(who);
      w.say(session, uid, fill(text), {
        name: nick,
        time: at(minutes),
        ...(extra.mention ? { mentioned: true } : {}),
      });
    }
  }
  await w.mind.recall.prepare(now);
  const events = scene.final.map(([who, text, extra = {}], i, all) => {
    const [uid, nick] = person(who);
    return w.say(session, uid, fill(text), {
      name: nick,
      time: now - (all.length - 1 - i) * 5000,
      ...(extra.mention ? { mentioned: true } : {}),
    });
  });
  const before = w.requests.length;
  const started = Date.now();
  let error = null;
  try {
    await w.hear(session, events);
  } catch (e) {
    error = String(e?.message || e).slice(0, 200);
  }
  const wallMs = Date.now() - started;
  const reply = w.sent.map((s) => s.text).join(" / ");
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
    version: VERSION,
    arm,
    id: scene.id,
    cat: scene.cat,
    reply,
    silent: !reply,
    choice: decision.choice || "",
    targets,
    wallMs,
    error,
    revisions: trace?.revisions || [],
    calls,
    prompt: w.requests
      .slice(before)
      .filter((r) => r.path !== "/embeddings")
      .map((r) => ({ systemChars: r.systemChars, promptChars: r.promptChars })),
    spend: spend(w.requests.slice(before)),
    seedSpend: spend(w.requests.slice(0, before)),
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
  const result = await run(scene);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(
    `${scene.id}\t${result.wallMs}ms\t${result.spend.requests}req\t${result.checks.passed}/${result.checks.total}\t${result.reply.slice(0, 60)}`,
  );
}
