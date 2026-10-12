// Re-applies the objective checks of the quality set to saved replies, so a
// corrected check never needs the model again.
//   node scripts/dev/quality-rescore.js <结果目录>...
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scenes } from "./quality-set/v1.js";
import { objective } from "./quality-checks.js";

for (const dir of process.argv.slice(2))
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const result = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const scene = scenes.find((s) => s.id === result.id);
    if (!scene) continue;
    result.checks = objective(scene, result);
    writeFileSync(join(dir, file), JSON.stringify(result, null, 2));
  }
