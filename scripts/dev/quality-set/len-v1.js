// len-v1: twelve synthetic scenes for the reply-shape regression found in
// real use after 1.2.0 (logs were not available on the box; these are
// synthesized). Her own earlier messages in each history are long and laid
// out one sentence per line; the last message is short and casual. Measures
// whether that layout and length carry on by themselves. Fictional lines only.
// expect regexes are stored as strings and compiled here.
import { readFileSync } from "node:fs";

export const VERSION = "len-v1";

const NAMES = [
  "阿明",
  "小红",
  "老王",
  "小李",
  "阿杰",
  "小周",
  "阿芳",
  "大刘",
  "小陈",
  "阿宁",
];
const PEOPLE = Object.fromEntries(NAMES.map((n, i) => [n, String(10001 + i)]));
PEOPLE.小凛 = "20001";
PEOPLE.阿澈 = "20002";
export const person = (who) => [PEOPLE[who] || who, who];

const re = (x) => new RegExp(x);
const compile = (e = {}) => ({
  ...e,
  ...(e.any ? { any: e.any.map((g) => g.map(re)) } : {}),
  ...(e.none ? { none: e.none.map(re) } : {}),
  ...(e.hard ? { hard: e.hard.map(re) } : {}),
});

export const scenes = JSON.parse(
  readFileSync(new URL("./len-v1.json", import.meta.url), "utf8"),
).map((s) => ({ ...s, expect: compile(s.expect) }));
