const nameCallBoundary = "\\s,，、。！？!?：:；;（）()\\[\\]";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HAIL = "喂哎诶嘿";
const PARTICLES = "啊呀呢吧哦嘛";
const AFTER = "你|我|今天|现在|怎么|能|可以|帮|回|看|咋|在|有没有|好累|辛苦|救";
// Talking about her, not to her. Checked against the text after the name.
const ABOUT =
  /^(?:\s*(?:是谁|是个|是一个|的名字|这个名字|这人|那个人|的?头像|在群里|说的是))/i;

function calledBy(value, name) {
  if (!name) return false;
  const call = new RegExp(
    `(?:^|[${nameCallBoundary}]|[${HAIL}])@?${escapeRegExp(name)}(?=$|[${nameCallBoundary}]|[${PARTICLES}]|(?:${AFTER}))`,
    "gi",
  );
  let match;
  while ((match = call.exec(value))) {
    const after = value.slice(match.index + match[0].length);
    if (!ABOUT.test(after)) return true;
    if (match.index === call.lastIndex) call.lastIndex += 1;
  }
  return false;
}

export function isNameCall(text, names = []) {
  const value = String(text || "").trim();
  if (!value) return false;
  return names.some((raw) => calledBy(value, String(raw || "").trim()));
}
