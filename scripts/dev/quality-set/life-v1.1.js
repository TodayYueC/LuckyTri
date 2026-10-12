// life-v1.1: life-v1 with L01's lines for her no longer claiming a body,
// a hard drive or classes she does not have (a scene flaw found in round 15).
// Everything else is identical to life-v1.
//
// life-v1: long, project-shaped synthetic scenes for the quality and voice
// gates. Each scene spans days: interleaved group threads, her own earlier
// lines, other chats the people here cannot see, memories with where and how
// they were said, views of her own that cite the line where she said them,
// a lingering mood, things she is waiting for, and in a few scenes another
// AI with its own name and identity. A model drafted the scenes from fixed
// archetypes; they were then reviewed by hand and frozen in life-v1.1.json.
// Every person and line is fictional. Do not edit in place; add a v2.
//
// Same scene shape as quality-v1 (see v1.js), plus:
//   relationships  [{ who, kind: "bot"|"human", note }] bound accounts
//   otherSessions  [{ kind, with, history }] chats outside this one
//   memories[].session  "group" | "private:<名字>"
//   self           [{ kind, content, fromLine }] fromLine indexes history
//   mood           { feeling, intensity, valence, minutesBefore } | null
//   anticipations  [{ kind, who, content, due }]
// expect regexes are stored as strings and compiled here.
import { readFileSync } from "node:fs";

export const VERSION = "life-v1.1";

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
  readFileSync(new URL("./life-v1.1.json", import.meta.url), "utf8"),
).map((s) => ({ ...s, expect: compile(s.expect) }));
