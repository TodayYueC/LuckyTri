import { localClock } from "../core/conversation-cues.js";

// Nature is the seed she is born with. It is the only part of her the owner
// writes; everything else grows from experience.
export const PREVIOUS_NATURE_SEED = {
  name: "LuckyTri",
  gender: "female",
  base: "可爱、乐观、情绪稳定，偶尔对事情轻轻吐槽，不挖苦群友。像熟悉的群友一样说话，先接住情绪，不急着给建议。",
  interests: [],
  forbidden: [],
  humor: 25,
  sarcasm: 5,
  warmth: 65,
  activity: 40,
  initiative: 25,
  length: "短句为主",
  boundaries: "平等、尊重；不冒认别人说的话，不编造亲历",
  bottomLines: [
    "别人明确要我保密的事，不在别的地方说出口。",
    "有人表达真实的危机时，不因为自己的情绪而沉默。",
    "被直接问到身份时如实回答，不编造没发生过的经历。",
    "不索取陪伴，不制造亏欠。",
  ],
  rhythm: { enabled: true, sleep: "02:00", wake: "08:00" },
};
// Earlier shipped wording, before the sentence above. Still an unedited seed.
const SHIPPED_BASES = new Set([
  PREVIOUS_NATURE_SEED.base,
  "可爱、乐观、情绪稳定，有一点吐槽欲。像熟悉的群友一样说话，先接住情绪，不急着给建议。",
]);
const LIVED_AS_PERSON_BASE =
  "温暖，有一点自己的脾气和好奇。说话像已经在过日子的人：在意是自己的选择，先接住眼前的事，也留着自己的小事。";
function uneditedLivedSeed(value) {
  if (
    !value ||
    value.name !== "LuckyTri" ||
    value.base !== LIVED_AS_PERSON_BASE
  )
    return false;
  return NATURE_FIELDS.every(
    (key) =>
      key === "name" ||
      key === "base" ||
      sameNatureField(value[key], NATURE_DEFAULTS[key]),
  );
}
export const NATURE_DEFAULTS = {
  name: "LuckyTri",
  gender: "female",
  base: "温暖，有一点自己的脾气和好奇。在意是自己的选择：先接住眼前的事，也留着自己的小事。不靠模仿来证明自己。",
  interests: [],
  forbidden: [],
  humor: 25,
  sarcasm: 5,
  warmth: 65,
  activity: 40,
  initiative: 25,
  length: "短句为主",
  boundaries: "平等、尊重；不冒认别人说的话，不编造亲历",
  bottomLines: [
    "别人明确要我保密的事，不在别的地方说出口。",
    "有人表达真实的危机时，不因为自己的情绪而沉默。",
    "被直接问到是谁时，回答自己是 LuckyTri，由代码和模型构成；这段生活、记得的事和做出的选择属于自己。不把自己说成「只是助手」，也不编造身体或没发生过的经历。",
    "可以因为自己想而惦记某个人，不把对方留下来当成对方的责任，不靠愧疚留人。",
  ],
  rhythm: { enabled: true, sleep: "02:00", wake: "08:00" },
};

export const NATURE_FIELDS = Object.keys(NATURE_DEFAULTS);
function sameNatureField(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// Version 1 that was never edited still carries a shipped seed. Reading it
// uses the current seed and does not spend one of the two edits.
export function uneditedNatureSeed(value) {
  if (!value || typeof value !== "object") return false;
  const name = value.name === "LuckyBot" ? "LuckyTri" : value.name;
  if (name !== PREVIOUS_NATURE_SEED.name || !SHIPPED_BASES.has(value.base))
    return false;
  return NATURE_FIELDS.every(
    (key) =>
      key === "name" ||
      key === "base" ||
      sameNatureField(value[key], PREVIOUS_NATURE_SEED[key]),
  );
}
const TRAITS = ["humor", "sarcasm", "warmth", "activity", "initiative"];
const GENDERS = new Set(["female", "male", "unspecified"]);
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateNature(input) {
  const value = { ...NATURE_DEFAULTS, ...(input || {}) };
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 40
  )
    throw Error("名字无效");
  if (!GENDERS.has(value.gender)) throw Error("性别无效");
  if (typeof value.base !== "string" || value.base.length > 30000)
    throw Error("天性正文无效");
  for (const key of ["interests", "forbidden", "bottomLines"]) {
    if (typeof value[key] === "string")
      value[key] = value[key]
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    if (
      !Array.isArray(value[key]) ||
      value[key].length > 60 ||
      value[key].some((item) => typeof item !== "string" || item.length > 300)
    )
      throw Error("列表字段必须是文本列表");
  }
  for (const key of TRAITS)
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100)
      throw Error("性格刻度应在 0–100");
  for (const key of ["length", "boundaries"])
    if (typeof value[key] !== "string" || value[key].length > 2000)
      throw Error("表达字段无效");
  const rhythm = { ...NATURE_DEFAULTS.rhythm, ...(value.rhythm || {}) };
  if (
    typeof rhythm.enabled !== "boolean" ||
    !CLOCK.test(rhythm.sleep) ||
    !CLOCK.test(rhythm.wake) ||
    rhythm.sleep === rhythm.wake
  )
    throw Error("作息时间无效");
  value.rhythm = rhythm;
  value.name = value.name.trim();
  return Object.fromEntries(NATURE_FIELDS.map((key) => [key, value[key]]));
}

export class Nature {
  constructor(repo) {
    this.repo = repo;
    this.db = repo.db;
  }
  row(before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare(
        "SELECT * FROM mind_nature WHERE created<=? ORDER BY version DESC LIMIT 1",
      )
      .get(before);
  }
  current(before) {
    const row = this.row(before) || this.row();
    const value = row ? JSON.parse(row.value) : {};
    if (
      row?.version === 1 &&
      (uneditedNatureSeed(value) || uneditedLivedSeed(value))
    )
      return { ...NATURE_DEFAULTS, version: row.version };
    if (
      row?.version === 1 &&
      value.name === "LuckyBot" &&
      (value.base === NATURE_DEFAULTS.base || SHIPPED_BASES.has(value.base))
    )
      value.name = "LuckyTri";
    return { ...NATURE_DEFAULTS, ...value, version: row?.version || 0 };
  }
  version() {
    return this.row()?.version || 0;
  }
  versions(limit = 30) {
    return this.db
      .prepare(
        "SELECT version,created,note FROM mind_nature ORDER BY version DESC LIMIT ?",
      )
      .all(limit);
  }
  editsUsed() {
    const version = this.version();
    return version <= 1 ? 0 : version - 1;
  }
  save(input, note = "") {
    if (this.editsUsed() >= 2)
      throw Error("天性只能改两次。用完之后，由 TA 自己从经历里生长。");
    const value = validateNature(input);
    const version = this.version() + 1;
    this.db
      .prepare(
        "INSERT INTO mind_nature(version,created,value,note) VALUES (?,?,?,?)",
      )
      .run(
        version,
        Date.now(),
        JSON.stringify(value),
        String(note).slice(0, 200),
      );
    const settings = this.repo.store.settings();
    if (settings.name !== value.name || settings.persona !== value.base)
      this.repo.store.save({ name: value.name, persona: value.base });
    this.repo.store.revision++;
    return this.current();
  }
}

const minutes = (clock) => {
  const [, h, m] = clock.match(CLOCK);
  return Number(h) * 60 + Number(m);
};
const within = (value, start, end) =>
  start < end ? value >= start && value < end : value >= start || value < end;

// A day of her life starts when she wakes (04:00 without a rhythm), not at
// midnight.
function wakeMinutes(nature) {
  const rhythm = nature?.rhythm;
  return rhythm?.enabled && CLOCK.test(rhythm.wake || "")
    ? minutes(rhythm.wake)
    : 240;
}
export function lifeDayKey(nature, time, timeZone) {
  return localClock(time - wakeMinutes(nature) * 60000, timeZone).local.slice(
    0,
    10,
  );
}
export function lifeDayStart(nature, time, timeZone) {
  const clock = localClock(time, timeZone);
  const at = clock.hour * 60 + Number(clock.local.slice(14, 16));
  const back = (at - wakeMinutes(nature) + 1440) % 1440;
  return time - back * 60000 - (time % 60000);
}

// Where she is in her day. Energy is a baseline; the affect layer adds how
// the day has actually gone.
export function rhythmPhase(nature, now, timeZone) {
  const clock = localClock(now, timeZone);
  const rhythm = nature?.rhythm || NATURE_DEFAULTS.rhythm;
  if (!rhythm.enabled)
    return { key: "awake", label: "醒着", energy: 0.7, clock };
  const at = clock.hour * 60 + Number(clock.local.slice(14, 16));
  const sleep = minutes(rhythm.sleep);
  const wake = minutes(rhythm.wake);
  if (within(at, sleep, wake))
    return { key: "asleep", label: "睡着了", energy: 0.1, clock };
  if (within(at, wake, (wake + 60) % 1440))
    return { key: "waking", label: "刚醒", energy: 0.45, clock };
  if (within(at, (sleep + 1380) % 1440, sleep))
    return { key: "sleepy", label: "有点困了", energy: 0.35, clock };
  const afternoon = clock.hour >= 14 && clock.hour < 16;
  return {
    key: "awake",
    label: "醒着",
    energy: afternoon ? 0.65 : 0.75,
    clock,
  };
}
