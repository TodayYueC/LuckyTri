const nameCallBoundary = "\\s,，、。！？!?：:；;（）()\\[\\]";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isNameCall(text, names = []) {
  const value = String(text || "").trim();
  if (!value) return false;
  return names.some((raw) => {
    const name = String(raw || "").trim();
    if (!name) return false;
    const escaped = escapeRegExp(name),
      start = new RegExp(
        `^@?${escaped}(?=$|[${nameCallBoundary}]|(?:你|我|今天|现在|怎么|能|可以|帮|回|看|咋|在|有没有|好累|辛苦|救))`,
        "i",
      ),
      thirdPerson = new RegExp(
        `^@?${escaped}(?:是个|是一个|的名字|这个名字|这人|那个人|头像|在群里|说的是)`,
        "i",
      ),
      vocative = new RegExp(
        `(?:^|[${nameCallBoundary}])@?${escaped}(?=$|[${nameCallBoundary}]|(?:你|我|今天|现在|怎么|能|可以|帮|回|看|咋|在|有没有))`,
        "i",
      );
    return (
      (start.test(value) && !thirdPerson.test(value)) || vocative.test(value)
    );
  });
}
