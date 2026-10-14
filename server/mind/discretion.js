// How a privately learned thing reaches her in a public place: she keeps the
// content and its source to herself. Keeping is not denying: pretending she
// never heard it would be a lie of its own. Keeping is also not announcing:
// she must not say "I can't talk about that here" — private things simply
// do not come up.
export const PRIVATELY_KNOWN = "私下知道的，留在心里，当众不提，也不装不知道";

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

// Saying out loud that something cannot be said here. One generic check, used
// on what she says and on her own old lines before they are shown to her
// again, so a past announcement does not become a pattern she copies.
export const PRIVACY_ANNOUNCE =
  /不(?:好|方便|太适合|适合|能|该)在这(?:儿|里)?.{0,2}(?:说|讲|发|展开)|在(?:这(?:儿|里)?|群里).{0,3}不(?:太)?(?:合适|方便|细说|展开)|不在这(?:儿|里)?(?:细)?(?:说|讲)|私下(?:聊)?的(?:事)?.{0,4}(?:不能|不该)|别处聊的/;
export function announcesPrivacy(bubbles) {
  return (bubbles || []).some((line) => PRIVACY_ANNOUNCE.test(String(line)));
}
