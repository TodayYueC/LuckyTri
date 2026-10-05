import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadVisionImages } from "../server/core/vision-manager.js";
import { visionImageLimits } from "../server/core/image-preprocessor.js";

const MiB = 1024 * 1024;
const publicLookup = async () => [{ address: "1.1.1.1", family: 4 }];
const imageUrl = "https://gchat.qpic.cn/large-photo.png";
let fixturePromise;

function largePng() {
  return (fixturePromise ||= (async () => {
    const width = 1600;
    const height = 1200;
    const pixels = Buffer.alloc(width * height * 3);
    let state = 0x417293ab;
    for (let i = 0; i < pixels.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[i] = state & 255;
    }
    const bytes = await sharp(pixels, {
      raw: { width, height, channels: 3 },
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    assert.ok(bytes.length > 4 * MiB, "fixture exceeds the old 4 MiB limit");
    return { bytes, width, height };
  })());
}

async function assertUsableImage(
  result,
  original,
  expectedWidth,
  expectedHeight,
) {
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.images.length, 1);
  const image = result.images[0];
  const match = image.url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  assert.ok(match, "models receive image bytes, never the remote URL");
  const output = Buffer.from(match[2], "base64");
  assert.ok(output.length <= 4 * MiB);
  assert.equal(
    image.sha256,
    createHash("sha256").update(original).digest("hex"),
  );
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, expectedWidth);
  assert.equal(metadata.height, expectedHeight);
  assert.ok((await sharp(output).raw().toBuffer()).length > 0);
}

test("视觉图像默认限制分离源图、模型负载、像素和下载时间", () => {
  const limits = visionImageLimits({});
  assert.equal(limits.maxSourceBytes, 32 * MiB);
  assert.equal(limits.maxModelBytes, 4 * MiB);
  assert.equal(limits.maxPixels, 80_000_000);
  assert.equal(limits.maxDimension, 8192);
  assert.equal(limits.maxOutputPixels, 16_000_000);
  assert.equal(limits.downloadTimeoutMs, 30000);
});

test("超过 4 MiB 的真实 PNG 经远程、内联和本地读取后保留尺寸并有界压缩", async () => {
  const { bytes, width, height } = await largePng();
  const folder = await mkdtemp(join(tmpdir(), "lucky-vision-loader-"));
  const file = join(folder, "large.png");
  try {
    await writeFile(file, bytes);
    const entries = [
      {
        image: { messageId: 1, speaker: "reader", url: imageUrl },
        options: {
          lookup: publicLookup,
          fetch: async () =>
            new Response(bytes, {
              headers: {
                "content-type": "image/png",
                "content-length": String(bytes.length),
              },
            }),
        },
      },
      {
        image: {
          messageId: 2,
          speaker: "reader",
          inline: "base64://" + bytes.toString("base64"),
        },
      },
      { image: { messageId: 3, speaker: "reader", local: file } },
    ];
    for (const entry of entries) {
      const result = await loadVisionImages([entry.image], entry.options);
      await assertUsableImage(result, bytes, width, height);
      assert.equal(result.images[0].messageId, entry.image.messageId);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("QQ get_image 恢复大图时保留会话通道并接受超过 4 MiB 的 base64", async () => {
  const { bytes, width, height } = await largePng();
  const calls = [];
  const result = await loadVisionImages(
    [{ messageId: 7, speaker: "reader", file: "QQ-LARGE-IMAGE-ID" }],
    {
      sessionId: "onebot:private:reader",
      fetchImage: async (...args) => {
        calls.push(args);
        return { base64: bytes.toString("base64") };
      },
    },
  );
  assert.deepEqual(calls, [["QQ-LARGE-IMAGE-ID", "onebot:private:reader"]]);
  await assertUsableImage(result, bytes, width, height);
});

test("没有 Content-Length 的流式大图超过源图上限即中断下载", async () => {
  const { bytes } = await largePng();
  let canceled = false;
  const result = await loadVisionImages(
    [{ messageId: 10, speaker: "reader", url: imageUrl }],
    {
      lookup: publicLookup,
      imageLimits: { maxSourceBytes: 1024 },
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 1025));
            },
            cancel() {
              canceled = true;
            },
          }),
        ),
    },
  );
  assert.equal(result.images.length, 0);
  assert.equal(result.unavailable[0].reason, "图片超过大小限制");
  assert.equal(canceled, true);
});

test("声明源图超限时取消正文而不读取图像数据", async () => {
  let canceled = false;
  let reads = 0;
  const body = {
    getReader() {
      reads++;
      throw Error("oversized body must never be read");
    },
    cancel: async () => {
      canceled = true;
    },
  };
  const result = await loadVisionImages(
    [{ messageId: 11, speaker: "reader", url: imageUrl }],
    {
      lookup: publicLookup,
      imageLimits: { maxSourceBytes: 1024 },
      fetch: async () => ({
        status: 200,
        headers: new Headers({ "content-length": "1025" }),
        body,
      }),
    },
  );
  assert.equal(result.images.length, 0);
  assert.equal(result.unavailable[0].reason, "图片超过大小限制");
  assert.equal(reads, 0);
  assert.equal(canceled, true);
});

test("内联和本地图片也遵守源图上限，本地超限不会先读入内存", async () => {
  const { bytes } = await largePng();
  const inline = await loadVisionImages(
    [{ messageId: 15, inline: "base64://" + bytes.toString("base64") }],
    { imageLimits: { maxSourceBytes: 1024 } },
  );
  assert.equal(inline.images.length, 0);
  assert.equal(inline.unavailable[0].reason, "图片超过大小限制");

  let readCount = 0;
  const local = await loadVisionImages(
    [{ messageId: 16, local: "C:/qq-cache/oversized.png" }],
    {
      imageLimits: { maxSourceBytes: 1024 },
      fs: {
        realpath: async (path) => path,
        stat: async () => ({ isFile: () => true, size: 1025 }),
        readFile: async () => {
          readCount++;
          throw Error("oversized local image must not be read");
        },
      },
    },
  );
  assert.equal(local.images.length, 0);
  assert.equal(local.unavailable[0].reason, "图片超过大小限制");
  assert.equal(readCount, 0);
});

test("图片正文中途下载超时会结束读取并允许后续重试", async () => {
  const { bytes } = await largePng();
  let aborted = false;
  const image = { messageId: 12, speaker: "reader", url: imageUrl };
  // AbortSignal.timeout uses an unref'd timer. This mock has no socket to keep
  // the event loop alive while a stalled response is being read.
  const keepAlive = setTimeout(() => {}, 1000);
  let failure;
  try {
    failure = await loadVisionImages([image], {
      lookup: publicLookup,
      imageLimits: { downloadTimeoutMs: 25 },
      fetch: async (_url, { signal }) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 20));
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        });
        return new Response(stream);
      },
    });
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(failure.images.length, 0);
  assert.equal(failure.unavailable[0].reason, "图片下载超时");
  assert.equal(aborted, true);
  const retry = await loadVisionImages([image], {
    lookup: publicLookup,
    fetch: async () => new Response(bytes),
  });
  assert.equal(retry.images.length, 1);
  assert.deepEqual(retry.unavailable, []);
});

test("标为 image/png 的 HTML 仍不能成为模型画面", async () => {
  const result = await loadVisionImages(
    [{ messageId: 13, speaker: "reader", url: imageUrl }],
    {
      lookup: publicLookup,
      fetch: async () =>
        new Response("<html><body>not an image</body></html>", {
          headers: { "content-type": "image/png" },
        }),
    },
  );
  assert.equal(result.images.length, 0);
  assert.equal(result.unavailable[0].reason, "不是支持的图片格式");
});

test("图片批次隔离损坏正文和假格式，仍保留正常图片及消息归属", async () => {
  const { bytes } = await largePng();
  const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.5));
  assert.ok(truncated.length < 4 * MiB);
  // Header metadata alone succeeds even though the actual pixels are missing.
  assert.equal((await sharp(truncated).metadata()).width, 1600);
  const good = await sharp({
    create: {
      width: 80,
      height: 40,
      channels: 3,
      background: "#aaddff",
    },
  })
    .png()
    .toBuffer();
  const result = await loadVisionImages([
    {
      messageId: 21,
      speaker: "first",
      inline: "base64://" + truncated.toString("base64"),
    },
    {
      messageId: 22,
      speaker: "second",
      inline: "base64://" + good.toString("base64"),
    },
    {
      messageId: 23,
      speaker: "third",
      inline:
        "base64://" + Buffer.from("<html>bad format</html>").toString("base64"),
    },
  ]);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].messageId, 22);
  assert.equal(result.images[0].speaker, "second");
  assert.equal(
    result.images[0].url,
    "data:image/png;base64," + good.toString("base64"),
  );
  assert.deepEqual(result.unavailable, [
    { messageId: 21, reason: "图片读取失败" },
    { messageId: 23, reason: "不是支持的图片格式" },
  ]);
});
