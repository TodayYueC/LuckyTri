const normalized = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");

// A result rank or internal segment number is never evidence that a web page
// belongs to this game. Require its actual title in the source, not the query.
export function belongsToGame(source, topic) {
  const name = normalized(topic);
  if (name.length < 2) return false;
  const title = normalized(source.title);
  const content = normalized(source.content);
  let url = "";
  try {
    url = normalized(decodeURIComponent(source.url || ""));
  } catch {}
  return title.includes(name) || content.includes(name) || url.includes(name);
}
