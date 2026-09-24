import { localClock } from "../core/conversation-cues.js";

export function elapsedLabel(time, now, zone = "Asia/Shanghai") {
  const age = Math.max(0, now - time);
  if (age < 5 * 60000) return "刚才";
  const day = localClock(time, zone).local.slice(0, 10);
  const today = localClock(now, zone).local.slice(0, 10);
  if (day === today) return "今天早些时候";
  if (day === localClock(now - 86400000, zone).local.slice(0, 10))
    return "昨天";
  return age < 7 * 86400000 ? "好几天前" : "很久以前";
}

// Coarse distance in time, the way a person would say it.
export function agoLabel(ms) {
  const days = Math.floor(Math.max(0, ms) / 86400000);
  if (days < 1) return "今天";
  if (days < 2) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export function topicWeight(
  time,
  now,
  { importance = 0, mentions = 1, open = false } = {},
) {
  const halfLife = (open ? 48 : 6) * 3600000 * (1 + Math.min(1, importance));
  return Math.min(
    1,
    Math.pow(0.5, Math.max(0, now - time) / halfLife) *
      (1 + Math.min(3, mentions - 1) * 0.1),
  );
}

export function timePhase(lastTime, now) {
  if (!lastTime)
    return {
      key: "unfamiliar",
      label: "还未相遇",
      description: "还没有真实聊天，时间暂时没有可以延续的落点。",
    };
  const age = Math.max(0, now - lastTime);
  if (age < 30 * 60000)
    return {
      key: "present",
      label: "仍在对话里",
      description: "刚才的语气和话题仍然清晰，适合自然接着聊。",
    };
  if (age < 3 * 3600000)
    return {
      key: "afterglow",
      label: "留有余韵",
      description: "聊天刚安静下来，刚才没说完的事还会留在注意里。",
    };
  if (age < 12 * 3600000)
    return {
      key: "settled",
      label: "各自生活",
      description: "注意力已经离开即时对话，但重要的事仍可能被想起。",
    };
  if (age < 2 * 86400000)
    return {
      key: "quiet",
      label: "安静了一阵",
      description: "旧话题正在降温，未完成的事情比普通闲聊更容易被想起。",
    };
  if (age < 7 * 86400000)
    return {
      key: "remembering",
      label: "偶尔想起",
      description: "相隔已有几天，熟悉感还在，但重新开口需要具体缘由。",
    };
  return {
    key: "reunion",
    label: "等待重逢",
    description: "已经隔了很久，旧事只保留为背景，新的消息会成为新的相遇。",
  };
}
