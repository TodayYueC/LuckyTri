// A quality-set scene as plain Chinese text, for the judge and for people
// reading blind samples.
const fmtTime = (ms) =>
  new Date(ms).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function sceneText(scene, name = "她") {
  const now = Date.parse(scene.start);
  const at = (m) => fmtTime(now - m * 60000);
  const fill = (t) =>
    String(t).replaceAll("@{name}", "@她").replaceAll("{name}", "她");
  const lines = [];
  lines.push(
    `【场景】${scene.kind === "group" ? "群聊（朋友群）" : `和${scene.with}的私聊`}；现在是 ${fmtTime(now)}`,
  );
  if (scene.memories?.length) {
    lines.push("【她记得的事（背景，对方看不到）】");
    for (const m of scene.memories) {
      const privately =
        (m.session || "").startsWith("private") ||
        (!m.session && scene.kind === "private");
      const from = m.saidBy ? m.saidBy[0] : m.who;
      const where = privately
        ? `${from}私聊里说的${m.discretion === "private" ? "，属于私下的事" : ""}`
        : `${from}在群里说的`;
      const said = m.saidBy ? m.saidBy[1] : m.said;
      lines.push(
        `- ${at(m.minutesBefore)}：${m.content}（${where}${said ? `，原话「${said}」` : ""}）`,
      );
    }
    if (scene.conflicts?.length)
      lines.push("- 上面两条说法对不上，都还没有定论");
  }
  const history = [...(scene.history || [])].sort((a, b) => b[0] - a[0]);
  if (history.length) {
    lines.push("【之前的对话】");
    for (const [m, who, text] of history)
      lines.push(`${at(m)} ${who === "me" ? name : who}：${fill(text)}`);
  }
  lines.push("【这一轮她收到】");
  for (const [who, text] of scene.final) lines.push(`${who}：${fill(text)}`);
  lines.push(`【评审看点】${scene.focus}`);
  return lines.join("\n");
}
