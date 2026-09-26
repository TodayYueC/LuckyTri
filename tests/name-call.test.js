import test from "node:test";
import assert from "node:assert/strict";
import { isNameCall } from "../server/core/name-call.js";
import { normalize } from "../server/channels/onebot.js";
import { messageEnvelope } from "../server/core/message-manager.js";
import { resolveTargets } from "../server/core/reply-target-resolver.js";

const names = ["LuckyTri", "Lucky"];

test("称呼她就算在叫她，议论她不算", () => {
  assert.equal(isNameCall("LuckyTri啊", names), true);
  assert.equal(isNameCall("哎LuckyTri", names), true);
  assert.equal(isNameCall("我说 LuckyTri 你看", names), true);
  assert.equal(isNameCall("LuckyTri，在吗", names), true);
  assert.equal(isNameCall("LuckyTri的头像好看", names), false);
  assert.equal(isNameCall("LuckyTri 的头像", names), false);
  assert.equal(isNameCall("LuckyTri是谁", names), false);
  assert.equal(isNameCall("今天风还挺大的", names), false);
});

test("@她时正文留下 @我，并用 user_id 认出是在叫她", () => {
  const m = normalize({
    post_type: "message",
    message_type: "group",
    self_id: 20002,
    user_id: 10001,
    group_id: 12345,
    message_id: 3,
    message: [
      { type: "at", data: { user_id: "20002" } },
      { type: "text", data: { text: "在吗" } },
    ],
  });
  assert.equal(m.mentioned, true);
  assert.match(m.text, /@我/);
  assert.match(m.text, /在吗/);
  const env = messageEnvelope(m);
  assert.deepEqual(env.mentions, ["20002"]);
  const [row] = resolveTargets(
    [{ ...env, seq: 1, role: "user" }],
    "LuckyTri",
    "Lucky",
  );
  assert.equal(row.relation, "direct");
});
