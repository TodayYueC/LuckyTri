// Which situational guidance a turn needs: writing guidance when the talk is
// about a piece of writing, bot guidance when another AI is speaking here.
// This is awareness of what is going on, never a template for her tone.
const WRITING =
  /小说|故事|诗|稿子|稿|章节|剧本|情节|片段|主线|作品|续写|写(?:了|一|个|篇|首|段|完)/;

// The other AIs in this conversation, by speaker id: each one is a named
// counterpart bound with relationship kind=bot. One place decides this.
export function botSpeakers(snapshot) {
  return new Set([
    ...(snapshot.inner?.relationships?.known || [])
      .filter((p) => p.kind === "bot")
      .map((p) => String(p.subjectId)),
    ...(snapshot.inner?.people || [])
      .filter((p) => p.relationship?.kind === "bot")
      .map((p) => String(p.id)),
  ]);
}

// Whether the turn needs the writing or bot-conversation guidance.
export function conversationNeeds(snapshot) {
  const bots = botSpeakers(snapshot);
  const recent = (snapshot.messages || [])
    .filter((m) => !m.referenceOnly)
    .slice(-12);
  const works = snapshot.inner?.currentLife?.works || [];
  // Works in view are not enough: only open creative guidance when the talk
  // itself is about writing, or someone named a specific work on the table.
  const namedWork = works.some((w) => {
    const title = String(w?.title || "");
    return (
      title.length >= 2 && recent.some((m) => (m.text || "").includes(title))
    );
  });
  return {
    creative: recent.some((m) => WRITING.test(m.text || "")) || namedWork,
    bots: recent.some((m) => m.role === "user" && bots.has(String(m.speaker))),
  };
}
