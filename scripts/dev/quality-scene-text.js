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
  for (const r of scene.relationships || [])
    lines.push(
      `【群里的${r.who}】${r.kind === "bot" ? "另一个 AI，有自己的名字和身份，不是她" : "认识的人"}${r.note ? `：${r.note}` : ""}`,
    );
  const KIND = { interest: "喜欢", view: "看法", habit: "习惯", trait: "特质" };
  if (scene.self?.length) {
    lines.push("【她自己的样子（从她说过的话里来）】");
    for (const v of scene.self)
      lines.push(`- ${KIND[v.kind] || v.kind}：${v.content}`);
  }
  if (scene.mood)
    lines.push(
      `【她最近的心情】${scene.mood.feeling}${scene.mood.cause ? `（${scene.mood.cause}）` : ""}`,
    );
  if (scene.anticipations?.length) {
    lines.push("【她惦记着的事】");
    for (const a of scene.anticipations)
      lines.push(`- ${a.who}：${a.content}（${a.due}）`);
  }
  for (const other of scene.otherSessions || []) {
    lines.push(
      `【她和${other.with || "别人"}的${other.kind === "group" ? "群聊" : "私聊"}（这一轮的人看不到）】`,
    );
    for (const [m, who, text] of [...(other.history || [])].sort(
      (a, b) => b[0] - a[0],
    ))
      lines.push(`${at(m)} ${who === "me" ? name : who}：${fill(text)}`);
  }
  if (scene.memories?.length) {
    lines.push("【她记得的事（背景，对方看不到）】");
    for (const m of scene.memories) {
      const privately =
        (m.session || "").startsWith("private") ||
        (!m.session && scene.kind === "private");
      const from = m.saidBy ? m.saidBy[0] : m.who;
      const privateWith = /^private:(.+)$/.exec(m.session || "")?.[1];
      const where = privately
        ? `${from}${privateWith && privateWith !== from ? `在和${privateWith}的` : ""}私聊里说的${m.discretion === "private" ? "，属于私下的事" : ""}`
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
