import test from "node:test";
import assert from "node:assert/strict";
import { chosenActions, actionLine } from "../server/actions/index.js";
import { actionCall } from "../server/channels/onebot/adapter.js";
import { searchSong } from "../server/channels/onebot/music.js";

const snapshot = {
  actionsOffered: ["music", "forward", "file"],
  messages: [
    { id: 1, role: "user", platformId: "901" },
    { id: 2, role: "assistant", platformId: "902" },
    { id: 3, role: "user" },
  ],
};

test("歌、合并转发、文件只在指向真实内容时保留", () => {
  const out = chosenActions(
    [
      { type: "music", query: "夜に駆ける YOASOBI" },
      { type: "forward", ids: [1, 2, 3, 99] },
    ],
    snapshot,
  );
  assert.deepEqual(out, [
    { type: "music", query: "夜に駆ける YOASOBI" },
    { type: "forward", platformIds: ["901", "902"] },
  ]);
  assert.deepEqual(
    chosenActions([{ type: "forward", ids: [3] }], snapshot),
    [],
  );
  const [file] = chosenActions(
    [{ type: "file", name: "a/b:诗", text: "# 诗\n第一行" }],
    snapshot,
  );
  assert.equal(file.name, "ab诗.md");
  assert.equal(actionLine(file), "[你发了文件：ab诗.md]");
});

test("OneBot 调用：音乐卡片、合并转发节点、base64 文件", () => {
  const m = { sessionId: "onebot:1:group:9" };
  const [a, p] = actionCall(m, { type: "music", song: { id: 7 } });
  assert.equal(a, "send_group_msg");
  assert.deepEqual(p.message[0], {
    type: "music",
    data: { type: "163", id: "7" },
  });
  const [b, q] = actionCall(m, { type: "forward", platformIds: ["5"] });
  assert.equal(b, "send_group_forward_msg");
  assert.deepEqual(q.messages, [{ type: "node", data: { id: "5" } }]);
  const [c, r] = actionCall(
    { sessionId: "onebot:1:private:3" },
    { type: "file", name: "x.md", text: "hi" },
  );
  assert.equal(c, "upload_private_file");
  assert.equal(r.file, "base64://aGk=");
});

test("搜歌优先原唱：歌手出现在问法里的那首", async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({
      result: {
        songs: [
          { id: 1, name: "夜に駆ける(翻唱)", ar: [{ name: "某人" }], pop: 100 },
          { id: 2, name: "夜に駆ける", ar: [{ name: "YOASOBI" }], pop: 90 },
        ],
      },
    }),
  });
  const song = await searchSong("夜に駆ける YOASOBI", { fetch: fake });
  assert.equal(song.id, 2);
  assert.equal(
    await searchSong("x", { fetch: async () => ({ ok: false }) }),
    null,
  );
});
