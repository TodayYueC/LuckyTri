// What a plugin may be given. The risk is shown when the owner agrees;
// the host is what actually refuses a call the plugin was not given.
export const PERMISSIONS = {
  "mind.read": {
    risk: "low",
    label: "知道她醒着没有、心情和在做什么",
  },
  notify: { risk: "low", label: "给工作室发一条通知" },
  ui: { risk: "low", label: "在工作室里放一个自己的页面" },
  "http.routes": { risk: "low", label: "给自己的页面提供接口" },
  senses: { risk: "medium", label: "把感知放进她的此刻" },
  observe: { risk: "medium", label: "把发生的事作为经历交给她" },
  "knowledge.offer": { risk: "medium", label: "往她的书架放资料" },
  activities: { risk: "medium", label: "给她一件可以自己做的事" },
  models: { risk: "medium", label: "使用她的模型服务" },
  "net.fetch": { risk: "medium", label: "访问声明过的网站" },
  actions: { risk: "high", label: "让她可以选择做一件事" },
  perceive: { risk: "high", label: "读取聊天里的附件" },
  channel: { risk: "high", label: "接入一个平台，并看到那里的消息" },
  "http.public": { risk: "high", label: "开放一个不需要令牌的地址" },
  "net.raw": { risk: "high", label: "自己直接联网" },
};

export const API_VERSION = "1.0";
export const API_FEATURES = [
  "senses",
  "observe",
  "activities",
  "actions",
  "perceive",
  "channel",
  "knowledge",
  "models",
  "http",
  "notify",
  "mind.read",
  "ui",
];

export function permissionKnown(name) {
  return Object.hasOwn(PERMISSIONS, name);
}
