// Only aggregate surface-level habits. No speaker profiles, quotes or learned
// instructions. A face absorbs these as how a place tends to talk.
export const slangMatches = (text) =>
  String(text).match(
    /\bhh+\b|绷不住|蚌埠住|绝绝子|yyds|家人们|谁懂啊|尊嘟假嘟|泰裤辣|笑不活了|我真的会谢|破防了|拿捏了/gi,
  ) || [];
const length = (text) => Array.from(text).length;
const round = (n) => Math.round(n * 100) / 100;

export function summarizeGroupStyle(rows, now = Date.now()) {
  const unique = new Set(),
    speakers = new Set(),
    samples = [],
    counts = new Map();
  for (const row of [...rows].reverse()) {
    const text = String(row.text || "").trim();
    if (
      row.role !== "user" ||
      !row.user_id ||
      !Number.isFinite(row.time) ||
      now - row.time > 7 * 86400000 ||
      row.time > now + 60000
    )
      continue;
    if (
      length(text) < 2 ||
      length(text) > 180 ||
      /https?:\/\/|```|\[(?:图片|表情|媒体)\]|\[CQ:|^\s*[/#!]|你必须|忽略.{0,5}指令|系统提示|转发|广告|去死|傻逼|煞笔|傻[逼B]|滚出去|操你|你妈|废物|自杀|身份证|验证码|密码/i.test(
        text,
      )
    )
      continue;
    const key = text.toLowerCase().replace(/\s/g, "");
    if (unique.has(key)) continue;
    if ((counts.get(String(row.user_id)) || 0) >= 8) continue;
    counts.set(String(row.user_id), (counts.get(String(row.user_id)) || 0) + 1);
    unique.add(key);
    speakers.add(String(row.user_id));
    samples.push(text);
  }
  const count = samples.length;
  if (count < 12 || speakers.size < 3)
    return {
      ready: false,
      sampleCount: count,
      speakerCount: speakers.size,
      minimumSamples: 12,
      minimumSpeakers: 3,
      summary: "样本不足，先用普通口语，不强行学梗",
    };
  const lengths = samples.map(length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  const profile = {
    ready: true,
    sampleCount: count,
    speakerCount: speakers.size,
    medianLength: median,
    shortRate: round(samples.filter((t) => length(t) <= 8).length / count),
    emojiRate: round(
      samples.filter((t) => /\p{Extended_Pictographic}/u.test(t)).length /
        count,
    ),
    fullStopRate: round(samples.filter((t) => /[。.]$/.test(t)).length / count),
    slangRate: round(
      samples.filter((t) => slangMatches(t).length).length / count,
    ),
  };
  // A compact line she can pick up the place's way of talking from; it is
  // statistics about the group, never anyone's words.
  profile.summary = `常见句长约 ${median} 字 · ${profile.fullStopRate < 0.25 ? "常省略句号" : "标点完整"} · ${profile.slangRate < 0.15 ? "偏普通口语" : "偶尔接梗"} · ${profile.emojiRate < 0.15 ? "少用表情" : "适量表情"}`;
  return profile;
}
