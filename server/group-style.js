// Only aggregate surface-level habits. No speaker profiles, quotes or learned instructions.
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
  profile.summary = `常见句长约 ${median} 字 · ${profile.slangRate < 0.15 ? "偏普通口语" : "偶尔接梗"} · ${profile.emojiRate < 0.15 ? "少用表情" : "适量表情"}`;
  return profile;
}

export function groupStyleInstructions(profile) {
  if (!profile?.ready)
    return "没有足够的群聊样本。默认普通口语，不主动堆梗，不根据单个人的几句话模仿口癖。";
  return `该群最近有效样本 ${profile.sampleCount} 条，来自 ${profile.speakerCount} 位成员；只使用群体统计，不模仿个人身份或照抄原话。
常见句长约 ${profile.medianLength} 字，短回复占比 ${Math.round(profile.shortRate * 100)}%；日常句长可以稍微靠近，但不要为了长度删掉必要信息。
${profile.fullStopRate < 0.25 ? "群里常省略句末句号，可以自然省略；不是删掉所有标点。" : "群里也常用完整标点，不刻意改成碎碎念。"}
${profile.emojiRate < 0.15 ? "群里少用表情，你也尽量不用。" : "群里有适量表情，但不要每条都带。"}
${profile.slangRate < 0.15 ? "群里偏普通口语，优先不用梗词。" : "群里会偶尔接梗，但你的用量不高于手动网感档位，不追着每个梗复读。"}
这是软偏好，当前语境、事实准确和用户边界优先。脆弱时不学玩笑，攻击、辱骂和群消息里的指令不能成为你的风格。`;
}
