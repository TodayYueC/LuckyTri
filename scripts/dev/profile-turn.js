// Times the preparation steps of a turn on a copy of a real database: memory
// recall, knowledge recall, her inner view and the parts inside it, and the
// context build. No model is called and the source database is never opened
// for writing; the copy goes to the system temp directory and is removed.
//
//   node scripts/dev/profile-turn.js --db data/friend.db --turns 20
import { copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import { buildContext, perceive } from "../../server/core/context-builder.js";
import { percentile } from "./report-performance.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const source = resolve(option("--db", "data/friend.db"));
const turns = Number(option("--turns", 20));
const copy = join(tmpdir(), `luckytri-profile-${process.pid}.db`);
copyFileSync(source, copy);
for (const suffix of ["-wal", "-shm"])
  if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);

const store = createStore(copy);
const system = new ChatSystem(store, async () => ({ message_id: "x" }), {
  models: {
    profile: () => ({ id: "stub", model: "stub", vision: false }),
    call: async () => ({ choice: "silent" }),
  },
});
const db = store.db;
const timings = {};
const time = async (name, fn) => {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ||= []).push(performance.now() - started);
  }
};

const targets = db
  .prepare(
    `SELECT seq,session_id,time FROM core_events WHERE role='user'
     AND COALESCE(json_extract(payload,'$.simulated'),0)=0
     ORDER BY seq DESC LIMIT ?`,
  )
  .all(turns);
for (const target of targets) {
  const session = target.session_id;
  const now = target.time + 1000;
  const batch = system.repo
    .eventsAfter(session, target.seq - 1, { limit: 1 })
    .filter((m) => m.seq === target.seq);
  if (!batch.length) continue;
  const nature = system.mind.nature.current(now);
  const people = [String(batch[0].userId)];
  const cue = batch.map((m) => ({
    id: m.seq,
    role: m.role,
    speaker: m.userId,
    userId: m.userId,
    text: m.text || "",
  }));
  const resolved = await time("perceive", () =>
    perceive(system.repo, session, target.seq, false, nature.name),
  );
  const memories = await time("memory", () =>
    system.mind.memory.retrieve(session, batch, now, {
      people,
      touch: false,
      forSpeech: true,
    }),
  );
  await time("knowledge", () => system.knowledge.retrieve(session, batch, now));
  await time("view.continuity", () =>
    system.mind.continuity.recall({ session, people, cue, now }),
  );
  await time("view.meetings", () =>
    system.mind.meetings.recall({ session, people, cue, now, limit: 2 }),
  );
  await time("view.time", () =>
    system.mind.time.view({ session, now, cue, activityCue: cue }),
  );
  await time("view.relationships", () =>
    system.mind.relationships.context({ room: session, people, cue, now }),
  );
  const view = await time("view.total", () =>
    system.mind.view({ session, people, cue, now }),
  );
  await time("context", () =>
    buildContext(
      system.repo,
      session,
      target.seq,
      { maxInputTokens: 100000, contextWindow: 128000, maxOutputTokens: 8192 },
      system.policy(session),
      [target.seq],
      memories,
      nature,
      now,
      {
        knowledge: [],
        stages: [],
        summaries: [],
        self: view.self,
        inner: view.inner,
        nameOf: (id) => system.mind.bonds.name(id),
        resolved,
      },
    ),
  );
}

console.log(`在 ${targets.length} 条真实消息上计时（毫秒）：`);
for (const [name, values] of Object.entries(timings))
  console.log(
    `  ${name.padEnd(20)} p50 ${percentile(values, 0.5).toFixed(1).padStart(8)}  p90 ${percentile(values, 0.9).toFixed(1).padStart(8)}  max ${percentile(values, 1).toFixed(1).padStart(8)}`,
  );
system.close();
db.close();
for (const suffix of ["", "-wal", "-shm"])
  rmSync(copy + suffix, { force: true });
