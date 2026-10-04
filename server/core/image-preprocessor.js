import sharp from "sharp";

const MIB = 1024 * 1024;
const TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heif: "image/avif",
};

function configured(value, fallback, min, max) {
  const number = Number(value);
  return value != null && value !== "" && Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

export function visionImageLimits(env = process.env) {
  return {
    maxSourceBytes: Math.floor(
      configured(env.VISION_SOURCE_MAX_MB, 32, 4, 64) * MIB,
    ),
    maxModelBytes: Math.floor(
      configured(env.VISION_MODEL_MAX_MB, 4, 1, 4) * MIB,
    ),
    maxPixels: 80_000_000,
    maxDimension: 8192,
    maxOutputPixels: 16_000_000,
    downloadTimeoutMs: Math.floor(
      configured(env.VISION_DOWNLOAD_TIMEOUT_SECONDS, 30, 5, 120) * 1000,
    ),
  };
}

export function imageMime(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 6 &&
    /^(GIF87a|GIF89a)$/.test(bytes.toString("ascii", 0, 6))
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const length = bytes.readUInt32BE(0);
    if (length >= 16 && length <= bytes.length) {
      for (let offset = 8; offset < Math.min(length, 64); offset += 4) {
        if (offset === 12) continue; // Minor version, not a compatible brand.
        if (
          ["avif", "avis"].includes(bytes.toString("ascii", offset, offset + 4))
        )
          return "image/avif";
      }
    }
  }
  return "";
}

// Bound work across all conversations, including downloads and decoded images.
let active = 0;
const waiting = [];
export async function withVisionImageSlot(run) {
  if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export async function prepareVisionImage(bytes, limits = visionImageLimits()) {
  if (!bytes.length || bytes.length > limits.maxSourceBytes)
    throw Error("图片超过大小限制");
  const mime = imageMime(bytes);
  if (!mime) throw Error("不是支持的图片格式");
  const input = { limitInputPixels: limits.maxPixels, pages: 1 };
  let metadata;
  try {
    metadata = await sharp(bytes, input).metadata();
  } catch (error) {
    if (/pixel limit/i.test(error.message)) throw Error("图片像素超过处理限制");
    throw Error("图片读取失败");
  }
  if (
    !TYPES[metadata.format] ||
    (metadata.format === "heif" && metadata.compression !== "av1")
  )
    throw Error("不是支持的图片格式");
  const oriented =
    metadata.autoOrient ||
    ([5, 6, 7, 8].includes(metadata.orientation)
      ? { width: metadata.height, height: metadata.width }
      : metadata);
  const { width, height } = oriented;
  if (!width || !height || width * height > limits.maxPixels)
    throw Error("图片像素超过处理限制");
  const scale = Math.min(
    1,
    limits.maxDimension / width,
    limits.maxDimension / height,
    Math.sqrt(limits.maxOutputPixels / (width * height)),
  );
  let targetWidth = Math.max(1, Math.floor(width * scale));
  let targetHeight = Math.max(1, Math.floor(height * scale));
  const frameOnly = metadata.pages > 1;
  if (
    bytes.length <= limits.maxModelBytes &&
    scale === 1 &&
    !frameOnly &&
    (!metadata.orientation || metadata.orientation === 1) &&
    mime !== "image/avif" &&
    mime !== "image/gif"
  ) {
    try {
      // Decode before passing through: intact headers can hide a truncated
      // image body. Discard the tiny probe and retain the original bytes.
      await sharp(bytes, input)
        .resize({ width: 1, height: 1, fit: "inside" })
        .raw()
        .timeout({ seconds: 10 })
        .toBuffer();
    } catch (error) {
      if (/timeout|timed out/i.test(error.message)) throw Error("图片处理超时");
      throw Error("图片读取失败");
    }
    return {
      bytes,
      mime,
      width,
      height,
      originalBytes: bytes.length,
      transformed: false,
      frameOnly: false,
    };
  }

  const pipeline = () =>
    sharp(bytes, input)
      .rotate()
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .timeout({ seconds: 10 });
  const result = (output, format) => ({
    bytes: output.data,
    mime: format,
    width: output.info.width,
    height: output.info.height,
    originalBytes: bytes.length,
    transformed: true,
    frameOnly,
  });
  try {
    // Try lossless encoding first: large uncompressed screenshots often fit
    // without shrinking text or introducing JPEG artefacts.
    if (mime !== "image/jpeg") {
      const png = await pipeline()
        .png({ compressionLevel: 6 })
        .toBuffer({ resolveWithObject: true });
      if (png.data.length <= limits.maxModelBytes)
        return result(png, "image/png");
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const output = await pipeline()
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: attempt === 0 ? 90 : 82, chromaSubsampling: "4:4:4" })
        .toBuffer({ resolveWithObject: true });
      if (output.data.length <= limits.maxModelBytes)
        return result(output, "image/jpeg");
      // First reduce encoding size while keeping the full dimensions. Only
      // shrink if that still cannot fit the model's request budget.
      if (attempt > 0) {
        const shrink = Math.min(
          0.85,
          Math.sqrt(limits.maxModelBytes / output.data.length) * 0.9,
        );
        targetWidth = Math.max(1, Math.floor(targetWidth * shrink));
        targetHeight = Math.max(1, Math.floor(targetHeight * shrink));
      }
    }
  } catch (error) {
    if (/timeout|timed out/i.test(error.message)) throw Error("图片处理超时");
    throw Error("图片读取失败");
  }
  throw Error("图片超过大小限制");
}
