import test from "node:test";
import assert from "node:assert/strict";
import { meetsDialogueQuality } from "../scripts/dev/evaluation-quality.js";

test("dialogue evaluation reads only required quality scores, not optional notes", () => {
  assert.equal(
    meetsDialogueQuality({
      understanding: 4,
      clarity: 4,
      engagement: 4,
      suggestions: ["可以更自然一点"],
    }),
    true,
  );
  assert.equal(meetsDialogueQuality({ understanding: 5, clarity: 5 }), false);
  assert.equal(
    meetsDialogueQuality({ understanding: 5, clarity: 3, engagement: 5 }),
    false,
  );
  assert.equal(meetsDialogueQuality(null), false);
});
