import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, repairJson } from "../server/core/model-json.js";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, defaultModel } from "../server/core/model-manager.js";

test("合法的 JSON 原样通过，代码围栏也照旧", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":["x"]}'), { a: 1, b: ["x"] });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson("[1,2]"), [1, 2]);
});

test("duplicate keys never silently replace an answer, including fences and syntax repairs", () => {
  for (const raw of [
    '{"bubbles":["我想谈谈这个问题"],"bubbles":["晚安"]}',
    '```json\n{"choice":"speak","choice":"silent"}\n```',
    '先给结果：{"decision":{"ok":true,"ok":false}} 后面一句',
    '{"bubbles":["回答"],"bubb\\u006ces":["收尾"]}',
    '{"bubbles":["回答"] "bubbles":["收尾"]}',
    '[{"text":"a","text":"b"}]',
  ])
    assert.throws(() => parseModelJson(raw), /重复字段/);
  assert.deepEqual(
    parseModelJson(
      '{"a":{"text":"一"},"b":{"text":"二"},"list":[{"text":"三"},{"text":"四"}]}',
    ),
    {
      a: { text: "一" },
      b: { text: "二" },
      list: [{ text: "三" }, { text: "四" }],
    },
  );
  assert.deepEqual(
    parseModelJson(
      '{"text":"字符串里的 \\"text\\": 不算键，{ } , : [ ]","other":1}',
    ),
    { text: '字符串里的 "text": 不算键，{ } , : [ ]', other: 1 },
  );
});

test("对象后面多出的说明、前面先想了一段，都不会丢掉这次回复", () => {
  assert.deepEqual(
    parseModelJson(
      '{"choice":"speak","bubbles":["在的"]}\n\n（以上是我的回复）',
    ),
    { choice: "speak", bubbles: ["在的"] },
  );
  assert.deepEqual(parseModelJson('好的，我来回答：\n{"choice":"silent"}'), {
    choice: "silent",
  });
  assert.deepEqual(
    parseModelJson(
      '<think>先想想他为什么这么说 {"x":1}</think>\n{"choice":"react"}',
    ),
    { choice: "react" },
  );
  assert.deepEqual(parseModelJson('一直在想……\n</think>{"choice":"decline"}'), {
    choice: "decline",
  });
  assert.deepEqual(
    parseModelJson('先给结果：```json\n{"a":1}\n```\n再补充一句'),
    { a: 1 },
  );
});

test("字符串里的花括号和转义不会骗过配对", () => {
  assert.deepEqual(
    parseModelJson('{"content":"这句里有 } 和 \\" 引号"} 后面多一句 {'),
    { content: '这句里有 } 和 " 引号' },
  );
});

test("常见的小失误可以修好：多余逗号、缺逗号、字符串里的换行和引号", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
  assert.deepEqual(parseModelJson('{"a":"x"\n"b":"y"}'), { a: "x", b: "y" });
  assert.deepEqual(parseModelJson('{"a":1 "b":2}'), { a: 1, b: 2 });
  assert.deepEqual(parseModelJson('{"a":{"c":1}\n"b":[]}'), {
    a: { c: 1 },
    b: [],
  });
  assert.deepEqual(parseModelJson('{"text":"第一行\n第二行\t尾"}'), {
    text: "第一行\n第二行\t尾",
  });
  assert.deepEqual(parseModelJson('{"text":"他说"你好"就走了","n":1}'), {
    text: '他说"你好"就走了',
    n: 1,
  });
});

test("括号种类写错时按开头补正，真实出现过的坏回复能救回来", () => {
  assert.deepEqual(
    parseModelJson(
      '{"bubbles":["那你去年最后去了吗"],"reason":"短句自然追问"]}',
    ),
    { bubbles: ["那你去年最后去了吗"], reason: "短句自然追问" },
  );
});

test("修复只在严格解析失败后才运行，合法内容不会被改写", () => {
  const legal = '{"text":"a, } ] b","list":[1,2],"q":"\\"引\\""}';
  assert.equal(repairJson(legal), legal);
});

test("被截断的、根本不是 JSON 的回复仍然报错，不从中间捡碎片", () => {
  assert.throws(() => parseModelJson('{"a":{"b":1}'), SyntaxError);
  assert.throws(() => parseModelJson("我现在不想回答"), SyntaxError);
  assert.throws(() => parseModelJson(""), SyntaxError);
  assert.throws(() => parseModelJson('{"a":"没有结束'), SyntaxError);
});

function manager(replies, calls) {
  const store = createStore(":memory:");
  const repo = new Repository(store);
  const models = new ModelManager(repo, {
    fetcher: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      const content = replies.shift();
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      };
    },
  });
  models.closeStore = () => store.db.close();
  return models;
}

const profile = () =>
  defaultModel({
    apiKey: "test",
    baseUrl: "http://model.test/v1",
    model: "m",
  });

test("第一次不是 JSON 时再问一次，第二次给对就不丢这一轮", async () => {
  const calls = [];
  const models = manager(["我想想怎么回", '{"choice":"speak"}'], calls);
  const trace = { calls: [] };
  const value = await models.call(
    profile(),
    "turn",
    "system json",
    { x: 1 },
    trace,
  );
  assert.deepEqual(value, { choice: "speak" });
  assert.equal(calls.length, 2);
  assert.match(trace.calls[0].error, /重试一次/);
});

test("两次都不是 JSON 才报错，模型测试不重试", async () => {
  const calls = [];
  const models = manager(["不是", "还不是"], calls);
  await assert.rejects(
    models.call(profile(), "turn", "system json", {}, { calls: [] }),
    SyntaxError,
  );
  assert.equal(calls.length, 2);
  const once = [];
  const testing = manager(["不是", '{"ok":true}'], once);
  await assert.rejects(
    testing.call(profile(), "test", "system json", {}, { calls: [] }),
    SyntaxError,
  );
  assert.equal(once.length, 1);
});

test("能修好的回复不必再花一次调用", async () => {
  const calls = [];
  const models = manager(['{"choice":"speak"}\n（完）'], calls);
  const value = await models.call(
    profile(),
    "turn",
    "system json",
    {},
    { calls: [] },
  );
  assert.deepEqual(value, { choice: "speak" });
  assert.equal(calls.length, 1);
});

test("duplicate dialogue output is retried explicitly instead of losing the first answer", async (t) => {
  const calls = [];
  const models = manager(
    [
      '{"choice":"speak","bubbles":["具体答案"],"bubbles":["先睡了"]}',
      '{"choice":"speak","bubbles":["具体答案","我想再聊两句"]}',
    ],
    calls,
  );
  t.after(models.closeStore);
  const trace = { calls: [] };
  const result = await models.call(profile(), "turn", "system json", {}, trace);
  assert.deepEqual(result.bubbles, ["具体答案", "我想再聊两句"]);
  assert.equal(calls.length, 2);
  assert.match(trace.calls[0].error, /重复字段/);
  assert.match(JSON.stringify(calls[1]), /每个字段只能写一次/);
});
