// Replays real turns captured in a private diagnostics export through the
// current turn + delivery code (isolated: nothing is sent or stored).
// Data never lives in the repo: REPLAY_DIR points at a private folder with
// cases.json. The key comes only from LLM_API_KEY.
//   REPLAY_DIR=/private/dir node scripts/dev/replay-real.js --tag base [--only c1,c2] [--conc 4]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { Repository } from "../../server/core/repository.js";
import { ModelManager } from "../../server/core/model-manager.js";
import {
  normalizeTurn,
  takeTurn,
  turnModel,
  withoutLinksIfFiltered,
} from "../../server/core/turn.js";
import { replyPrompt } from "../../server/core/persona-manager.js";
import { ReplyDelivery } from "../../server/core/reply-delivery.js";
import { speechLength } from "../../server/core/speech-length.js";
import { PRIVATELY_KNOWN } from "../../server/mind/discretion.js";
import { MODEL_CATALOG } from "../../server/core/model-presets.js";
import { LinkReader } from "../../server/web/link-reader.js";
const links = new LinkReader();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const dir = process.env.REPLAY_DIR;
if (!dir) throw Error("需要 REPLAY_DIR");
if (!process.env.LLM_API_KEY) throw Error("需要环境变量 LLM_API_KEY");
const tag = arg("--tag", "run");
const only = arg("--only", "");
const conc = Number(arg("--conc", 4));
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")).filter(
  (c) => !only || only.split(",").includes(c.id),
);
const models = new ModelManager(new Repository(createStore(":memory:")));

function fakeOwner() {
  return {
    repo: { eventsAfter: () => [] },
    queue: { closed: false, lanes: new Map(), retain() {} },
    enabled: () => true,
    sessionState: () => "s",
    clearEpoch: new Map(),
    now: () => Date.now(),
    mind: {
      memory: { secretsOutside: () => [] },
      meetings: { privateSayings: () => [] },
      relationships: { discloses: () => false },
    },
  };
}

async function run(c) {
  const snapshot = structuredClone(c.snapshot);
  // Recorded before round 24: memories she may not disclose here were kept
  // as placeholders. Speech recall now leaves them out; replay the same way.
  // Old discretion labels are read as today's wording.
  (function relabel(o) {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o))
      if (k === "discretion" && typeof o[k] === "string")
        o[k] = PRIVATELY_KNOWN;
      else relabel(o[k]);
  })(snapshot);
  if (Array.isArray(snapshot.memories))
    snapshot.memories = snapshot.memories.filter(
      (m) => !/^（关于此人的/.test(String(m?.content || "")),
    );
  const ids = new Set(snapshot.batchIds || []);
  snapshot.batch ||= snapshot.messages.filter((m) => ids.has(m.id));
  const { nature, prompts } = c.config;
  // --policy key=value,... overrides the instance policy for an experiment.
  const policy = { ...c.config.policy };
  for (const pair of arg("--policy", "").split(",").filter(Boolean)) {
    const [k, v] = pair.split("=");
    policy[k] = v === "true" ? true : v === "false" ? false : v;
  }
  // Same model and effort as production, through the evaluation account.
  const preset = MODEL_CATALOG.find(
    (m) => m.id === arg("--preset", "volcengine-agent-plan-glm-5.3-flash"),
  );
  const model = {
    ...c.config.model,
    ...preset,
    reasoningEffort: arg("--effort", c.config.model.reasoningEffort || "high"),
    apiKey: "",
  };
  const trace = { id: c.id, steps: [], calls: [] };
  const started = Date.now();
  let out = { id: c.id };
  try {
    if (!process.argv.includes("--no-links")) {
      const read = await links.forMessages(snapshot.batch);
      if (read.length) snapshot.links = read;
    }
    const turn = normalizeTurn(
      await withoutLinksIfFiltered(snapshot, trace, () =>
        takeTurn(
          models,
          // Same as production: group turns think at quick effort.
          // --full-effort replays the configured effort instead.
          !process.argv.includes("--full-effort")
            ? turnModel(model, {
                group: c.session.startsWith("group:"),
                direct: snapshot.batch.some((m) => m.relation === "direct"),
                policy,
              })
            : model,
          replyPrompt(nature, prompts, "turn"),
          snapshot,
          trace,
          { images: [] },
        ),
      ),
      snapshot,
      trace,
      { speech: speechLength(nature) },
    );
    let status = "silent";
    if (turn.choice !== "silent") {
      const delivery = new ReplyDelivery(fakeOwner());
      await delivery.speak({
        session: c.session,
        batch: snapshot.batch,
        turn,
        snapshot,
        trace,
        finish: (s) => (status = s),
        models,
        model,
        nature,
        prompt: prompts,
        policy,
        state: "s",
        watermark: snapshot.watermark,
        clearEpoch: 0,
        privateChat: !c.session.startsWith("group:"),
        direct: snapshot.batch.some((m) => m.relation === "direct"),
        replay: true,
        pressure: 0,
        generationImages: [],
      });
    }
    out = {
      ...out,
      status,
      choice: turn.choice,
      felt: turn.felt,
      reason: turn.reason,
      after: status === "replayed" ? trace.response?.bubbles || [] : [],
      draft: turn.bubbles,
      revisions: trace.revisions || [],
    };
  } catch (error) {
    out.error = error.message;
  }
  out.ms = Date.now() - started;
  out.calls = trace.calls.map(
    (x) => `${x.stage}:${Math.round((x.elapsed || 0) / 1000)}`,
  );
  // Token use per call, to tell slow thinking from a slow endpoint.
  out.usage = trace.calls.map((x) => ({
    stage: x.stage,
    bytes: x.requestBytes,
    effort: x.request?.body?.reasoning?.effort,
    ...(x.usage || {}),
  }));
  return out;
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: conc }, async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const r = await run(c);
      results.push(r);
      console.log(
        r.id,
        r.status || r.error,
        r.ms,
        JSON.stringify(r.after || []),
      );
    }
  }),
);
const file = join(dir, `run-${tag}.json`);
writeFileSync(file, JSON.stringify(results, null, 1));
console.log("wrote", file);
