import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeVisionDescription,
  mergeVision,
} from "../server/core/vision-manager.js";
import {
  groundingIssues,
  mediaAttributionIssues,
} from "../server/core/conversation-grounding.js";
import {
  currentExchange,
  mediaInView,
  dialogueContext,
} from "../server/core/dialogue-context.js";

test("sanitizeVisionDescription: 去掉话题渗入，保留画面内容", () => {
  const dirty =
    "手机浏览器截图，显示英文文档《Concise Research Roadmap》。发送人当时正参与关于机器人测试和实装的聊天，但图内文字本身是一份AI研究路线图文档，截图上无批注或表情，发送意图无法从画面确定。";
  const clean = sanitizeVisionDescription(dirty);
  assert.match(clean, /Research Roadmap|路线图/);
  assert.doesNotMatch(clean, /实装的聊天|发送意图|正参与关于/);
});

test("mergeVision: 观察挂上发送者，并清洗描述", () => {
  const snapshot = {
    messages: [
      {
        id: 21822,
        role: "user",
        speaker: "duoshen",
        name: "我在多神后面",
        text: "[图片]",
        attachments: [{ type: "image", available: true }],
      },
    ],
  };
  mergeVision(snapshot, [
    {
      messageId: 21822,
      description:
        "研究路线图截图。发送人当时正参与关于实装的聊天，发送意图无法确定。",
    },
  ]);
  const row = snapshot.vision.observations[0];
  assert.equal(row.speaker, "duoshen");
  assert.equal(row.name, "我在多神后面");
  assert.match(row.description, /研究路线图/);
  assert.doesNotMatch(row.description, /实装的聊天|发送意图/);
});

test("mediaInView / currentExchange: 图文归属进 exchange", () => {
  const snapshot = {
    batchIds: [22, 23],
    messages: [
      {
        id: 12,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "下午实装之后大幅提升",
      },
      {
        id: 22,
        role: "user",
        speaker: "duoshen",
        name: "我在多神后面",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
      {
        id: 23,
        role: "user",
        speaker: "juyi",
        name: "居易",
        text: "[提及成员] 有的",
      },
    ],
    vision: {
      observations: [
        {
          messageId: 22,
          speaker: "duoshen",
          name: "我在多神后面",
          description: "21年研究路线图截图",
        },
      ],
    },
  };
  const media = mediaInView(snapshot);
  assert.equal(media[0].speaker, "duoshen");
  const exchange = currentExchange(snapshot);
  assert.equal(exchange.ownership[0].kind, "image");
  assert.equal(exchange.ownership[1].kind, "short");
  assert.equal(exchange.mediaInView[0].name, "我在多神后面");
  assert.match(exchange.instruction, /mediaInView|发送者/);
  const ctx = dialogueContext(snapshot);
  assert.equal(ctx.vision.observations[0].speaker, "duoshen");
});

test("图文乱绑：别人的图不能说成邻句「实装」内容", () => {
  const snapshot = {
    batchIds: [22, 23],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "跑了900多轮测试，下午实装之后lucky可你的那个大幅提升",
      },
      {
        id: 11,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "史诗级加强",
      },
      {
        id: 22,
        role: "user",
        speaker: "duoshen",
        name: "我在多神后面",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
      {
        id: 23,
        role: "user",
        speaker: "juyi",
        name: "居易",
        text: "[提及成员] 有的",
      },
    ],
    vision: {
      observations: [
        {
          messageId: 22,
          speaker: "duoshen",
          name: "我在多神后面",
          description:
            "手机截图，英文文档 Concise Research Roadmap，2021年研究路线图",
        },
      ],
    },
  };
  const bad = [
    "居易这句'有的'回答得好果断，我都不敢细问对什么有的",
    "另外 你这实装内容是给我塞了份21年的研究路线图？跟我有啥关系，我这版本更新附赠阅读材料吗",
  ];
  const issues = mediaAttributionIssues(bad, snapshot);
  assert.ok(
    issues.some((line) => /实装|归属|发的/.test(line)),
    issues.join(" | "),
  );
  assert.ok(groundingIssues(bad, snapshot).length);

  const ok = [
    "居易这句'有的'挺干脆",
    "多神这张路线图截图挺正经，跟实装不是一回事吧",
  ];
  assert.deepEqual(mediaAttributionIssues(ok, snapshot), []);
});

test("理解错位：短句对象没有发图时，不能说「你这图态度」", () => {
  const snapshot = {
    batchIds: [5],
    messages: [
      {
        id: 3,
        role: "user",
        speaker: "evil",
        name: "杜王町恶少",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
      {
        id: 5,
        role: "user",
        speaker: "yang",
        name: "阳",
        text: "不是",
      },
    ],
    vision: {
      observations: [
        {
          messageId: 3,
          speaker: "evil",
          name: "杜王町恶少",
          description: "一张玩笑表情图",
        },
      ],
    },
  };
  const issues = mediaAttributionIssues(
    ["行行行，当我没问，你这图态度已经很明确了（"],
    snapshot,
  );
  assert.ok(
    issues.some((line) => /图是|不是本轮/.test(line)),
    issues.join(" | "),
  );
});
