// One dropdown everywhere: pages use the shared Select, never a bare <select>.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../studio-web/src", import.meta.url));
function vue(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? vue(path)
      : name.endsWith(".vue")
        ? [path]
        : [];
  });
}
test("pages use the shared Select and Toggle, not bare controls", () => {
  const bare = vue(root)
    .filter((f) => !f.endsWith(join("components", "ui", "Select.vue")))
    .filter((f) => /<select[\s>]/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bare, []);
});
