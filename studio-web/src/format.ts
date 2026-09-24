export function clockTime(
  value: number | null | undefined,
  timeZone = "Asia/Shanghai",
) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function dayLabel(day: string) {
  const [, month, date] = day.split("-").map(Number);
  return month && date ? `${month} 月 ${date} 日` : day;
}

export function weekday(day: string) {
  const d = new Date(day + "T12:00:00");
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(d);
}

export function ago(value: number | null | undefined, now = Date.now()) {
  if (!value) return "";
  const minutes = Math.round((now - value) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} 个月前` : `${Math.round(months / 12)} 年前`;
}

export function num(value: unknown) {
  return Number(value || 0).toLocaleString("zh-CN");
}

export function tokens(value: number) {
  if (value >= 1_000_000)
    return `${+(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export function initials(name: string) {
  const text = String(name || "?").trim();
  return /^[\x00-\x7f]/.test(text)
    ? text.slice(0, 2).toUpperCase()
    : text.slice(-2);
}

// A stable hue per name, so the same person keeps the same color.
export function hueOf(value: string) {
  let h = 0;
  for (const ch of String(value)) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
