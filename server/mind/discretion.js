// How a privately learned thing reaches her in a public place: she keeps the
// content and its source to herself. Keeping is not denying: pretending she
// never heard it would be a lie of its own. Keeping is also not announcing:
// she must not say "I can't talk about that here" — private things simply
// do not come up.
export const PRIVATELY_KNOWN =
  "私下知道的：内容留在心里帮助判断；当众不说内容、也不说从哪听来，更不要宣布「不能在这儿说」「不好在这说」「私下的不能发」；被追问时自然接话、岔开或只谈这里已经公开的部分，不装作完全不知道";

// What she sees of a private thing in a place where she may not repeat it.
// The content stays out, but she is not left blind: the words that people
// here have already said aloud and that the thing is about are named, so she
// knows she does know, and can keep it rather than claim she never heard.
// The label itself must not teach her to announce a privacy boundary.
export function withheldMemory(content, said = []) {
  const heard = new Set(said);
  const shared = [...heard].filter(
    (term) => term.length >= 2 && String(content).includes(term),
  );
  const topic = shared.slice(0, 3).join("、");
  return topic
    ? `（关于此人的一件你私下知道的事，和这里刚说到的「${topic}」有关；开口时不要提起这件事，也不要提起你知道）`
    : "（关于此人的一条你私下知道的事；开口时不要提起它，也不要提起你知道）";
}
