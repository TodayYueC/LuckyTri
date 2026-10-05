import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { crc32 } from "node:zlib";
import {
  prepareVisionImage,
  visionImageLimits,
  imageMime,
} from "../server/core/image-preprocessor.js";
import { buildMessages } from "../server/core/model-manager.js";

const limits = visionImageLimits({});

test("正常小照片保留原字节，压缩配置有界且非法配置回到默认", async () => {
  const photo = await sharp({
    create: { width: 200, height: 120, channels: 3, background: "#e4acd7" },
  })
    .jpeg()
    .toBuffer();
  const image = await prepareVisionImage(photo, limits);
  assert.equal(image.transformed, false);
  assert.equal(image.mime, "image/jpeg");
  assert.deepEqual(image.bytes, photo);
  assert.deepEqual([image.width, image.height], [200, 120]);
  assert.equal(
    visionImageLimits({ VISION_SOURCE_MAX_MB: "NaN" }).maxSourceBytes,
    32 * 1048576,
  );
  assert.equal(
    visionImageLimits({ VISION_SOURCE_MAX_MB: "500" }).maxSourceBytes,
    64 * 1048576,
  );
  assert.equal(
    visionImageLimits({ VISION_MODEL_MAX_MB: "100" }).maxModelBytes,
    4 * 1048576,
  );
  assert.equal(
    visionImageLimits({ VISION_DOWNLOAD_TIMEOUT_SECONDS: "45" })
      .downloadTimeoutMs,
    45000,
  );
});

test("大截图先无损压缩，保留文字画面的全部像素与原始尺寸", async () => {
  const screenshot = await sharp({
    create: { width: 2200, height: 1100, channels: 4, background: "#faf9fd" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="2200" height="1100"><rect x="180" y="230" width="1800" height="3" fill="#2c1454"/><rect x="180" y="330" width="1000" height="3" fill="#a43776"/></svg>',
        ),
      },
    ])
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(screenshot.length > 4 * 1048576);
  const image = await prepareVisionImage(screenshot, limits);
  assert.equal(image.mime, "image/png");
  assert.deepEqual([image.width, image.height], [2200, 1100]);
  assert.ok(image.bytes.length < limits.maxModelBytes);
  assert.deepEqual(
    await sharp(image.bytes).raw().toBuffer(),
    await sharp(screenshot).raw().toBuffer(),
  );
});

test("真实大照片超预算时压缩与缩放，不裁切、不拉伸、不修改原图", async () => {
  let seed = 7;
  const pixels = Buffer.alloc(3000 * 2000 * 3);
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const photo = await sharp(pixels, {
    raw: { width: 3000, height: 2000, channels: 3 },
  })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  assert.ok(photo.length > 4 * 1048576);
  const original = Buffer.from(photo);
  const image = await prepareVisionImage(photo, limits);
  assert.ok(image.bytes.length <= limits.maxModelBytes);
  assert.equal(image.mime, "image/jpeg");
  assert.ok(image.width <= 3000 && image.height <= 2000);
  assert.ok(Math.abs(image.width / image.height - 1.5) < 0.005);
  assert.deepEqual(photo, original);
  const decoded = await sharp(image.bytes).metadata();
  assert.equal(decoded.width, image.width);
  await sharp(image.bytes).raw().toBuffer();
});

test("手机照片按 EXIF 转正，不把方向信息丢掉后横着发给模型", async () => {
  const photo = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#baa1d9" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const image = await prepareVisionImage(photo, limits);
  assert.deepEqual([image.width, image.height], [80, 120]);
  assert.equal(image.transformed, true);
  const metadata = await sharp(image.bytes).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
});

test("AVIF 转成模型通用画面，动态图读取首帧并说明观察范围", async () => {
  const avif = await sharp({
    create: { width: 96, height: 64, channels: 3, background: "#eacd89" },
  })
    .avif()
    .toBuffer();
  assert.equal(imageMime(avif), "image/avif");
  const image = await prepareVisionImage(avif, limits);
  assert.ok(["image/jpeg", "image/png"].includes(image.mime));
  assert.deepEqual([image.width, image.height], [96, 64]);

  const frames = Buffer.alloc(16 * 16 * 2 * 4, 255);
  for (let pixel = 16 * 16 * 4; pixel < frames.length; pixel += 4)
    frames.fill(0, pixel, pixel + 3);
  const gif = await sharp(frames, {
    raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
  })
    .gif({ delay: [100, 100] })
    .toBuffer();
  const first = await prepareVisionImage(gif, limits);
  assert.equal(first.mime, "image/png");
  assert.equal(first.frameOnly, true);
  assert.deepEqual([first.width, first.height], [16, 16]);
  const messages = buildMessages({ system: true }, "规则", {}, [
    {
      ...first,
      messageId: 1,
      speaker: "1",
      url: "data:image/png;base64," + first.bytes.toString("base64"),
    },
  ]);
  assert.match(JSON.stringify(messages), /只读取了动态图的第一帧/);
});

test("像素炸弹和伪图片在提交模型前拒绝，不移除输入处理限额", async () => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const bomb = Buffer.from(png);
  bomb.writeUInt32BE(100000, 16);
  bomb.writeUInt32BE(100000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  await assert.rejects(
    prepareVisionImage(bomb, limits),
    /图片像素超过处理限制/,
  );
  await assert.rejects(
    prepareVisionImage(Buffer.from('<svg width="100" height="100"/>'), limits),
    /不是支持的图片格式/,
  );
  await assert.rejects(
    prepareVisionImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), limits),
    /图片读取失败/,
  );
});
