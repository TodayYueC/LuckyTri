// The owner's "说话长度" setting, read as a default tendency. It never sets a
// quota: how many messages and how long each one is stays her judgment of
// the moment. Older saved values are free text and keep working: they are
// read by meaning, never rewritten.
export const SPEECH_LENGTHS = {
  短句为主: {
    key: "short",
    tendency:
      "短句优先：平时像在 QQ 里随手打字，一句话说一个意思；想说的不止一句时，可以分成几条接着发，也可以一句就停。条数和长短由你按此刻决定，不为凑条数拆句，也不为显得完整写成一段。",
    maxBubbles: 4,
  },
  自然: {
    key: "natural",
    tendency:
      "自然长短：跟着内容走，多数时候一两句，意思连贯的放在同一条里；条数和长短由你按此刻决定。",
    maxBubbles: 3,
  },
  允许长段: {
    key: "long",
    tendency:
      "允许长段：需要时可以在一条消息里把一段话说完整；闲聊时照样可以很短。条数和长短由你按此刻决定。",
    maxBubbles: 3,
  },
};
export const SPEECH_LENGTH_OPTIONS = Object.keys(SPEECH_LENGTHS);
// Labels a person may have typed before the setting became a choice.
const SAVED_ALIASES = { 短句优先: "短句为主", 自然长短: "自然" };

export function speechLength(nature) {
  const raw = String(nature?.length ?? "").trim();
  const name = SPEECH_LENGTHS[raw]
    ? raw
    : SAVED_ALIASES[raw] ||
      (/长段|长一点|详细|展开|完整|多说/.test(raw)
        ? "允许长段"
        : /自然|随意|看情况|适中|不限/.test(raw) && !/短/.test(raw)
          ? "自然"
          : "短句为主");
  return {
    option: name,
    ...SPEECH_LENGTHS[name],
    // A custom wording the owner wrote stays visible to her as written.
    ...(raw && raw !== name && !SAVED_ALIASES[raw] ? { ownerWords: raw } : {}),
  };
}
