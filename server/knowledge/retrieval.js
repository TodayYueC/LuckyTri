export function lexicalTerms(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .match(/[a-z0-9]+|[\u4e00-\u9fff]{1,2}/g) || [],
  );
}

export function ftsTokens(s) {
  return [...lexicalTerms(s)].join(" ");
}

export function ftsMatchQuery(s) {
  return [...lexicalTerms(s)]
    .slice(0, 24)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .filter((t) => t.length > 2)
    .join(" OR ");
}

export function overlapScore(text, queryTerms) {
  if (!queryTerms?.size) return 0;
  return [...lexicalTerms(text)].filter((t) => queryTerms.has(t)).length;
}

export function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function packVector(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

export function unpackVector(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return Array.from(
    new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
  );
}

export function asPlainDocument(text) {
  let source = String(text || "").replace(/\r\n/g, "\n");
  if (/<\/?[a-z][\s\S]*>/i.test(source))
    source = source
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, title) => {
        const hashes = "#".repeat(Number(level) || 1);
        return `\n${hashes} ${title.replace(/<[^>]+>/g, "").trim()}\n`;
      })
      .replace(/<[^>]+>/g, " ");
  return source
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text, { size = 600, overlap = 80 } = {}) {
  const source = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!source) return [];
  const parts = source.split(/(?=^#{1,3} )/m);
  const chunks = [];
  for (const part of parts) {
    const heading = part.match(/^#{1,3} ([^\n]+)/)?.[1] || "";
    const chars = Array.from(part.trim());
    if (!chars.length) continue;
    if (chars.length <= size) {
      chunks.push({ heading, text: part.trim() });
      continue;
    }
    for (let i = 0; i < chars.length; i += Math.max(1, size - overlap)) {
      const slice = chars
        .slice(i, i + size)
        .join("")
        .trim();
      if (slice) chunks.push({ heading, text: slice });
      if (i + size >= chars.length) break;
    }
  }
  return chunks;
}
