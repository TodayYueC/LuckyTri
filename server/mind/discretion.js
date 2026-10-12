// How a privately learned thing reaches her in a public place: she keeps the
// content and its source to herself. Keeping is not denying: pretending she
// never heard it would be a lie of its own.
export const PRIVATELY_KNOWN =
  "私下知道的：当众不说内容，也不说从哪听来；有人追问就说这不该在这儿讲，不装作不知道";

// What she sees of a private thing in a place where she may not repeat it.
// The content stays out, but she is not left blind: the words that people
// here have already said aloud and that the thing is about are named, so she
// knows she does know, and can keep it rather than claim she never heard.
export function withheldMemory(content, said = []) {
  const heard = new Set(said);
  const shared = [...heard].filter(
    (term) => term.length >= 2 && String(content).includes(term),
  );
  const topic = shared.slice(0, 3).join("、");
  return topic
    ? `（关于此人的一件私下的事，和这里刚说到的「${topic}」有关；内容不在这里复述）`
    : "（关于此人的一条受限记忆；没有在这里复述具体内容的授权）";
}
