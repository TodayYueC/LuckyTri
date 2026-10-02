import { createHash } from "node:crypto";
import { parseSessionKey } from "../../channels/session-key.js";
import { evidence, normalized, parse } from "../util.js";

export function gameTopic(title) {
  return (
    String(title).match(
      /Rewrite|ATRI|CLANNAD|Summer Pockets|星露谷物语|原神|崩坏：星穹铁道|Minecraft/i,
    )?.[0] ||
    String(title).match(/[《「]([^》」]{1,60})[》」]/)?.[1] ||
    ""
  );
}
function ordinal(value) {
  if (/^\d+$/.test(value)) return String(Number(value));
  const digits = {
    零: 0,
    〇: 0,
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
  };
  if (value === "十") return "10";
  if (value.includes("十")) {
    const [a, b] = value.split("十");
    return String((a ? digits[a] : 1) * 10 + (b ? digits[b] : 0));
  }
  return digits[value] === undefined ? value : String(digits[value]);
}
export function intentUnit(title) {
  const match = String(title).match(
    /第\s*([\d零〇一二两三四五六七八九十]+)\s*(章|节|幕|篇|关|卷|部)/,
  );
  return match
    ? {
        key: ordinal(match[1]) + match[2],
        label: "第" + ordinal(match[1]) + match[2],
      }
    : null;
}
export function intentScope(db, session = "") {
  if (!session) return "self";
  try {
    const p = parseSessionKey(session);
    let account = p.accountId;
    if (account === "_") {
      const accounts = db
        .prepare(
          "SELECT DISTINCT account_id FROM core_events WHERE session_id=? AND account_id IS NOT NULL AND account_id!='' AND time<=? LIMIT 2",
        )
        .all(session, Number.MAX_SAFE_INTEGER);
      if (accounts.length === 1) account = String(accounts[0].account_id);
    }
    return `${p.channel}:${account}:${p.kind}:${p.nativeId}`;
  } catch {
    return String(session);
  }
}
export function intentRecipient(
  db,
  { session, subject, title, sources = [], accepted = false },
) {
  if (subject) return String(subject);
  try {
    const p = parseSessionKey(session);
    if (p.kind === "private") return p.nativeId;
  } catch {}
  if (!accepted && !/汇报|发给|给你|让你看|交付|分享/.test(title)) return "";
  const recipients = new Set();
  for (const ref of evidence(sources).filter((s) => s.startsWith("m:"))) {
    const event = db
      .prepare(
        "SELECT seq,session_id,payload FROM core_events WHERE seq=? AND role='assistant'",
      )
      .get(Number(ref.slice(2)));
    for (const seq of parse(event?.payload, {}).replyTargetIds || []) {
      const m = db
        .prepare(
          "SELECT payload FROM core_events WHERE seq=? AND seq<? AND session_id=? AND role='user' AND seq NOT IN (SELECT seq FROM mind_unlived)",
        )
        .get(Number(seq), event.seq, event.session_id);
      const user = parse(m?.payload, {}).userId;
      if (user) recipients.add(String(user));
    }
  }
  return recipients.size === 1 ? [...recipients][0] : "";
}
export function intentMessageSources(db, row, message) {
  const targets = (
    Array.isArray(message.replyTargetIds) ? message.replyTargetIds : []
  ).filter((seq) =>
    db
      .prepare(
        "SELECT 1 FROM core_events WHERE seq=? AND seq<? AND session_id=? AND role='user' AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
      )
      .get(Number(seq), row.seq, row.session_id),
  );
  return evidence([row.seq, ...targets.map(Number)]);
}
export function taskIntent(
  db,
  {
    title = "",
    activity,
    session,
    session_id,
    subject,
    sources = [],
    projectId,
    project_id,
  },
) {
  session ??= session_id;
  const scope = intentScope(db, session),
    recipient = intentRecipient(db, { session, subject, title, sources }),
    unit = intentUnit(title);
  let topic = "",
    operation = "do";
  if (activity === "game") topic = gameTopic(title);
  else if (["write", "read"].includes(activity))
    topic = String(title).match(/[《「]([^》」]{1,100})[》」]/)?.[1] || "";
  if (activity === "write") {
    operation = /修改|重写|修订/.test(title)
      ? "revise"
      : /续写|接续|下一篇/.test(title)
        ? "continue"
        : "write";
  }
  if (/重玩|重新玩|重读|再读一遍|再玩一遍/.test(title)) operation = "repeat";
  const anchored = !!topic,
    key = anchored
      ? createHash("sha256")
          .update(
            JSON.stringify([
              scope,
              recipient,
              activity,
              normalized(topic),
              unit?.key || "",
              operation,
            ]),
          )
          .digest("hex")
      : null;
  return {
    key,
    anchored,
    scope,
    recipient,
    topic,
    unit,
    operation,
    project: projectId || project_id || null,
  };
}
