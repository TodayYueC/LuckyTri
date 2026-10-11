import { localClock } from "./conversation-cues.js";

const DAY = 86400000;
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const WEEKDAY_NAME = [
  "",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];
const NUMBER = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
const RELATIVE_DAY = {
  大前天: -3,
  前天: -2,
  昨天: -1,
  今天: 0,
  明天: 1,
  后天: 2,
  大后天: 3,
};

function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  const tens = value.match(/^([一二三])?十([一二三四五六七八九])?$/);
  if (tens)
    return (
      (tens[1] ? NUMBER[tens[1]] : 1) * 10 + (tens[2] ? NUMBER[tens[2]] : 0)
    );
  return NUMBER[value] ?? NaN;
}

// A calendar day in her time zone, as plain numbers.
function localDay(time, zone) {
  const local = localClock(time, zone).local;
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return { y, m, d, weekday };
}
const shift = ({ y, m, d }, days) => {
  const at = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return {
    y: at.getUTCFullYear(),
    m: at.getUTCMonth() + 1,
    d: at.getUTCDate(),
    weekday: at.getUTCDay() || 7,
  };
};
const iso = ({ y, m, d }) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// The dates a Chinese sentence points to, relative to when it was said:
// 明天, 后天, 下周三, 这周末, 月底, 12号, 3月5日. Deterministic, so the model
// is told which day "下周三" was instead of having to count.
export function timeExpressions(text, said, zone = "Asia/Shanghai") {
  const value = String(text || "");
  const base = localDay(said, zone);
  const found = [];
  const add = (match, day, precision = "day") => {
    if (!day || found.some((f) => f.text === match)) return;
    const date = iso(day);
    found.push({
      text: match,
      date,
      weekday: WEEKDAY_NAME[day.weekday],
      precision,
      relation:
        date < iso(base) ? "past" : date === iso(base) ? "today" : "future",
    });
  };
  for (const match of value.matchAll(/大前天|前天|昨天|今天|明天|大后天|后天/g))
    add(match[0], shift(base, RELATIVE_DAY[match[0]]));
  for (const match of value.matchAll(/(今|明|昨)(?:早|晚|晨|夜)/g))
    add(match[0], shift(base, { 今: 0, 明: 1, 昨: -1 }[match[1]]));
  for (const match of value.matchAll(
    /(下下|下个?|上个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天])/g,
  )) {
    const prefix = match[1] || "";
    const weeks = prefix.startsWith("下下")
      ? 2
      : prefix.startsWith("下")
        ? 1
        : prefix.startsWith("上")
          ? -1
          : 0;
    add(match[0], shift(base, weeks * 7 + WEEKDAY[match[2]] - base.weekday));
  }
  for (const match of value.matchAll(/(下个?|这个?|本)?周末/g)) {
    const weeks = (match[1] || "").startsWith("下") ? 1 : 0;
    add(match[0], shift(base, weeks * 7 + 6 - base.weekday), "weekend");
  }
  for (const match of value.matchAll(/下个月|下月/g)) {
    const m = base.m === 12 ? 1 : base.m + 1;
    add(
      match[0],
      { y: base.m === 12 ? base.y + 1 : base.y, m, d: 1, weekday: 0 },
      "month",
    );
  }
  for (const match of value.matchAll(/月底|月末/g))
    add(
      match[0],
      shift({ y: base.y, m: base.m, d: lastOfMonth(base.y, base.m) }, 0),
    );
  for (const match of value.matchAll(
    /(?:(\d{1,2}|[一二三四五六七八九十]{1,3})月)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:号|日)(?!子|本|元)/g,
  )) {
    const d = chineseNumber(match[2]);
    let m = match[1] ? chineseNumber(match[1]) : base.m;
    let y = base.y;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= lastOfMonth(y, m))) continue;
    // A bare day or month that already passed usually means the next one.
    if (!match[1] && d < base.d - 3) m = m === 12 ? 1 : m + 1;
    if (match[1] && (m < base.m - 1 || (m === base.m - 1 && d < base.d)))
      y += 1;
    if (m === 1 && base.m === 12 && !match[1]) y = base.y + 1;
    add(match[0], shift({ y, m, d }, 0));
  }
  for (const match of value.matchAll(/过两天|这两天/g))
    add(match[0], shift(base, 2), "approximate");
  return found.map((item) =>
    item.precision === "month"
      ? { ...item, date: item.date.slice(0, 7), weekday: undefined }
      : item,
  );
}
