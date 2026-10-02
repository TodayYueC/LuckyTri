import { readableName } from "./speaker-names.js";

// Only a person's own explicit request supplies a preferred form of address.
export function requestedName(value) {
  const words = String(value || "").trim();
  if (/不要记|别记|不许记|不要叫我|别叫我|忘掉/.test(words)) return "";
  const match = words.match(
    /(?:^|[，,。！!；;\s])(?:以后|今后|请(?:你)?|麻烦|你(?:就|可以)?|记住[，,：:\s]*)*(?:叫我|称呼我(?:为)?|(?:记住[，,：:\s]*)?我的(?:名字|昵称)(?:是|叫)|记住[，,：:\s]*我叫)[\s：:]*[“"「『]?([^，,。！!？?；;\n”"」』]{1,32})/u,
  );
  if (!match) return "";
  const name = match[1]
    .trim()
    .replace(/(?:就好|就行|即可|好吗|吧|哦|呀|啦)$/, "")
    .trim();
  if (
    /^(?:group|private|onebot):|^(?:群聊|私聊)\s*\d|^(?:去|来|帮|把|别|先|等|做|打开|关掉|回答|发消息)|叫你|不要|记住/.test(
      name,
    )
  )
    return "";
  return readableName(name, "");
}
