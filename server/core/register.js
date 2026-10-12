// How the people in this conversation actually type: how long a message
// usually is, whether lines end in full stops, which particles and laughs
// keep coming back. It is measured from their own recent messages and given
// to the turn as data, so her wording can follow the room the way a person
// adapts to friends, instead of a written instruction about tone.
const MARKERS = [
  "hh",
  "哈哈",
  "草",
  "笑死",
  "？？",
  "啊",
  "吧",
  "嘛",
  "呢",
  "哦",
  "诶",
  "欸",
  "嗯",
  "啦",
  "呗",
  "666",
  "。。",
  "…",
];
const WRITING =
  /小说|故事|诗|稿子|稿|章节|剧本|情节|片段|主线|作品|续写|写(?:了|一|个|篇|首|段|完)/;

function botSpeakers(snapshot) {
  return new Set([
    ...(snapshot.inner?.relationships?.known || [])
      .filter((p) => p.kind === "bot")
      .map((p) => String(p.subjectId)),
    ...(snapshot.inner?.people || [])
      .filter((p) => p.relationship?.kind === "bot")
      .map((p) => String(p.id)),
  ]);
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const plain = (text) =>
  String(text || "")
    .replace(/@\S+/g, "")
    .replace(/\[[^\]]{1,20}\]/g, "")
    .trim();

export function chatRegister(snapshot, now) {
  now = Number.isFinite(now) ? now : Date.now();
  const bots = botSpeakers(snapshot);
  const recent = (snapshot.messages || []).filter(
    (m) =>
      !m.referenceOnly &&
      (!Number.isFinite(m.time) || now - m.time <= 3 * 3600000),
  );
  const theirs = recent
    .filter((m) => m.role === "user" && !bots.has(String(m.speaker)))
    .map((m) => plain(m.text))
    .filter(Boolean)
    .slice(-20);
  if (theirs.length < 2) return null;
  const counts = MARKERS.map((marker) => [
    marker,
    theirs.filter((t) => t.includes(marker)).length,
  ]).filter(([, n]) => n >= 2);
  const stops = theirs.filter((t) => /[。！]$/.test(t)).length;
  return {
    theirMedianChars: median(theirs.map((t) => t.length)),
    endsWithFullStop: `${stops}/${theirs.length}`,
    ...(counts.length
      ? {
          markers: counts
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([m]) => m),
        }
      : {}),
  };
}

// Whether the turn needs the writing or bot-conversation guidance.
export function conversationNeeds(snapshot) {
  const bots = botSpeakers(snapshot);
  const recent = (snapshot.messages || [])
    .filter((m) => !m.referenceOnly)
    .slice(-12);
  return {
    creative:
      recent.some((m) => WRITING.test(m.text || "")) ||
      (snapshot.inner?.currentLife?.works || []).length > 0,
    bots: recent.some((m) => m.role === "user" && bots.has(String(m.speaker))),
  };
}
