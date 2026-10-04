// What she can spend time on. The four built-in kinds keep their own
// execution paths; a plugin adds a kind and only supplies material. Nothing
// here knows that plugins exist: a kind is a kind.

const registry = new Map();

function define(kind) {
  registry.set(kind.kind, kind);
}

define({
  kind: "write",
  label: "写作",
  builtin: true,
  minutes: [15, "写作、推敲与收尾"],
  energy: true,
  pattern: /写|小说|短篇|诗|随笔|故事/,
});
define({
  kind: "game",
  label: "正在玩",
  builtin: true,
  minutes: [25, "本段剧情与场景体验"],
  energy: true,
  pattern: /游戏|Rewrite|ATRI|盲开|通关|打完.+章|游玩/i,
});
define({
  kind: "read",
  label: "阅读",
  builtin: true,
  minutes: [15, "阅读与消化本段内容"],
  pattern: /读|阅读|看.{0,12}(?:书|资料|文章)/,
});
define({
  kind: "think",
  label: "独处思考",
  builtin: true,
  minutes: [10, "思考与整理本段想法"],
  pattern: /思考|想一想|想想|整理思路/,
});
define({
  kind: "unknown",
  label: "等待澄清",
  builtin: true,
  placeholder: true,
});

export const BUILTIN_ACTIVITIES = ["write", "read", "think", "game"];

const KIND_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]{0,40}$/;

export function registerActivity(kind) {
  if (!KIND_NAME.test(kind?.kind || "")) throw Error("活动类型无效");
  if (registry.get(kind.kind)?.builtin) throw Error("不能覆盖内置的活动");
  registry.set(kind.kind, {
    minutes: [15, "本段活动"],
    energy: false,
    enabled: true,
    blockReason: "",
    ...kind,
    plugin: true,
  });
}

export function unregisterActivities(pluginId) {
  for (const [kind, def] of registry)
    if (def.pluginId === pluginId) registry.delete(kind);
}

export function setActivityEnabled(kind, enabled, reason = "") {
  const def = registry.get(kind);
  if (!def?.plugin) return;
  def.enabled = !!enabled;
  def.blockReason = enabled ? "" : reason || "所需插件已停用";
}

export function activityOf(kind) {
  return registry.get(kind) || null;
}

export function activityLabel(kind, fallback = "活动") {
  return registry.get(kind)?.label || fallback;
}

export function activityMinutes(kind) {
  return registry.get(kind)?.minutes || [15, "本段活动"];
}

export function needsEnergy(kind) {
  return !!registry.get(kind)?.energy;
}

export function isPluginActivity(kind) {
  return !!registry.get(kind)?.plugin;
}

// A kind she can actually begin. Unknown is a placeholder, and a stopped
// plugin's kind is not.
export function isExecutable(kind) {
  const def = registry.get(kind);
  if (!def || def.placeholder) return false;
  return def.builtin || !!def.enabled;
}

export function activityEnum({ unknown = false } = {}) {
  const kinds = [...BUILTIN_ACTIVITIES];
  for (const def of registry.values())
    if (def.plugin && def.enabled) kinds.push(def.kind);
  if (unknown) kinds.push("unknown");
  return kinds.join("|");
}

export function pluginActivities() {
  return [...registry.values()].filter((def) => def.plugin);
}

// Same order as before: writing wins over a game, a game over reading.
export function classifyActivity(words) {
  const source = String(words || "");
  for (const kind of ["write", "game", "read", "think"])
    if (registry.get(kind).pattern.test(source)) return kind;
  for (const def of registry.values())
    if (def.plugin && def.enabled && def.pattern?.test(source)) return def.kind;
  return "unknown";
}

export function wakeActivities(db, pluginId, now) {
  const kinds = pluginActivities()
    .filter((def) => def.pluginId === pluginId && def.enabled)
    .map((def) => def.kind);
  if (!kinds.length) return 0;
  const waiting = db
    .prepare(
      `SELECT id,ready_at FROM mind_time_tasks WHERE state='waiting' AND wait_reason='所需插件已停用' AND activity IN (${kinds.map(() => "?").join(",")}) AND json_extract(checkpoint,'$.mergedInto') IS NULL`,
    )
    .all(...kinds);
  const resume = db.prepare(
    "UPDATE mind_time_tasks SET state='todo',wait_reason='',ready_at=?,updated=? WHERE id=? AND state='waiting'",
  );
  for (const row of waiting)
    resume.run(Math.max(now, row.ready_at || now), now, row.id);
  return waiting.length;
}

// Keeps the built-in wording when no plugin kind is registered, and extends
// it once one is.
export function withActivities(prompt) {
  const extra = pluginActivities()
    .filter((def) => def.enabled)
    .map((def) => def.kind);
  const quoted = ["read", "write", "think", "game", ...extra]
    .map((kind) => `"${kind}"`)
    .join("|");
  return String(prompt)
    .replaceAll(
      "write|read|think|game|unknown",
      activityEnum({ unknown: true }),
    )
    .replaceAll("write|read|think|game", activityEnum())
    .replaceAll('"read"|"write"|"think"|"game"', quoted);
}

export function pluginAvailable() {
  const out = {};
  for (const def of pluginActivities()) out[def.kind] = !!def.enabled;
  return out;
}

export function holdsClock(kind) {
  return kind === "game" || isPluginActivity(kind);
}
