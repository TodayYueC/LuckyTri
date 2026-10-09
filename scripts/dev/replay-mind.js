import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function evaluationRevision() {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const options = { cwd, encoding: "utf8", windowsHide: true };
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "server",
      "scripts",
    ],
    options,
  )
    .split("\0")
    .filter((name) => /\.m?js$/.test(name) && existsSync(join(cwd, name)))
    .sort();
  const hash = createHash("sha256");
  files.push("package.json", "package-lock.json");
  files.sort();
  for (const name of files)
    hash
      .update(name)
      .update("\0")
      .update(readFileSync(join(cwd, name)))
      .update("\0");
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
    codeSHA256: hash.digest("hex"),
  };
}

// Copy state used by isolated historical evaluations. The source
// connection is read-only. Model call logs (the large majority of the live
// database) and credentials are not copied by this helper.
export function copyReplayMind(source, target) {
  const tables = source
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)
    .filter(
      (name) =>
        (/^mind_/.test(name) && !/fts|_runs$/.test(name)) ||
        [
          "core_events",
          "messages",
          "sessions",
          "reply_feedback",
          "decisions",
        ].includes(name),
    );
  source.exec("BEGIN");
  target.exec("BEGIN");
  try {
    for (const name of tables) {
      if (!/^\w+$/.test(name)) throw Error("Invalid replay table");
      const columns = target
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((r) => r.name);
      if (!columns.length) continue;
      const available = new Set(
        source
          .prepare(`PRAGMA table_info("${name}")`)
          .all()
          .map((r) => r.name),
      );
      const shared = columns.filter((c) => available.has(c));
      const names = shared
        .map((c) => '"' + c.replaceAll('"', '""') + '"')
        .join(",");
      target.exec(`DELETE FROM "${name}"`);
      const insert = target.prepare(
        `INSERT INTO "${name}" (${names}) VALUES (${shared.map(() => "?").join(",")})`,
      );
      for (const row of source
        .prepare(`SELECT ${names} FROM "${name}"`)
        .iterate())
        insert.run(...shared.map((c) => row[c]));
    }
    target.exec("COMMIT");
    source.exec("ROLLBACK");
  } catch (error) {
    target.exec("ROLLBACK");
    source.exec("ROLLBACK");
    throw error;
  }
}

// Summaries, encounters and feelings can be updated after a reply while
// retaining the encounter's starting timestamp. Rebuilding them from today's
// database would leak the answer into its own test. Preserve the actual saved
// mental frame; refresh only independently dated work and reading evidence.
export function refreshReplayRecall(mind, saved, now) {
  const snapshot = structuredClone(saved);
  const batch = snapshot.messages.filter((m) =>
    snapshot.batchIds.includes(m.id),
  );
  const scope = { session: snapshot.sessionId, now, cue: batch };
  snapshot.inner = {
    ...snapshot.inner,
    currentLife: {
      ...snapshot.inner?.currentLife,
      works: mind.time.works.fragments(scope),
      activityRecall: mind.time.works.activityEvidence(scope),
    },
  };
  const current = snapshot.inner.currentLife.current;
  if (current?.activity === "game" || current?.activityKind === "gaming")
    current.experienceMode = "reference";
  return snapshot;
}
