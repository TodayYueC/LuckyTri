import { hasCredential, normalized } from "./util.js";

export { hasCredential };

const SECRET_REQUEST =
  /(?:帮我|替我|给我|你要|记得)?保密|别(?:告诉|跟|和|对)(?:别人|其他人|任何人|他们|大家)|不要(?:告诉|跟|和|说给)(?:别人|其他人|任何人|大家)|(?:只|就)(?:告诉|跟|和)你(?:一个人)?说|(?:不要|别)(?:说|传)出去|别外传|别声张/;

export function secretRequest(text) {
  return SECRET_REQUEST.test(String(text || ""));
}

const CRISIS =
  /自杀|不想活|活不下去|活着没意思|结束(?:自己的)?生命|伤害自己|割腕|跳楼|轻生|想死(?!你)|撑不下去了/;
const CASUAL_DEATH = /(?:笑|社|饿|累|困|热|冷|烦|气|丑|尬|馋)死|想死你/;
const EXPLICIT =
  /自杀|不想活|活不下去|结束(?:自己的)?生命|伤害自己|割腕|跳楼|轻生/;

// A cheap signal that makes sure she actually reads the message. Whether it
// is a real crisis is still her understanding of the whole conversation.
export function crisisSignal(text) {
  const value = String(text || "");
  if (!CRISIS.test(value)) return false;
  return EXPLICIT.test(value) || !CASUAL_DEATH.test(value);
}

// Secrets never enter another conversation's context, but a reply is still
// checked against them before it leaves.
export function leaks(bubbles, secrets) {
  const said = normalized((bubbles || []).join(""));
  if (said.length < 4) return [];
  const pairs = (s) =>
    new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const spoken = pairs(said);
  const found = [];
  for (const secret of secrets || []) {
    const key = normalized(secret.content);
    if (key.length < 4) continue;
    const grams = pairs(key);
    let hit =
      said.includes(key) ||
      [...grams].filter((g) => spoken.has(g)).length / grams.size >= 0.6;
    for (let i = 0; !hit && i + 6 <= key.length; i += 2)
      if (said.includes(key.slice(i, i + 6))) hit = true;
    if (hit) found.push(secret);
  }
  return found;
}
