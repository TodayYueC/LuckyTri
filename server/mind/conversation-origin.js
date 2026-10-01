import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";
import { evidence, parse } from "./util.js";

// A public memory may be recalled everywhere. That does not turn everyone
// into a participant. Retellings retain the original speakers and add no one.
export function conversationOrigin(db, sources, before = Date.now()) {
  const queue = evidence(sources),
    seen = new Set(),
    rooms = new Map();
  let incomplete = false;
  const event = db.prepare(
    "SELECT seq,session_id,time,role,payload FROM core_events WHERE seq=? AND time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived)",
  );
  const take = (row) => {
    if (!row) return;
    let identity;
    try {
      identity = parseSessionKey(row.session_id);
    } catch {
      return;
    }
    if (!rooms.has(row.session_id))
      rooms.set(row.session_id, {
        sessionId: row.session_id,
        channel: identity.channel,
        kind: identity.kind,
        people: new Map(),
      });
    const room = rooms.get(row.session_id),
      payload = parse(row.payload, {});
    if (row.role === "user" && payload.userId && payload.userId !== "bot")
      room.people.set(String(payload.userId), {
        id: String(payload.userId),
        name: payload.name || "这位参与者",
      });
    if (row.role === "assistant") {
      // Confirmed replies credit their actual addressees, never nearby members.
      for (const seq of (Array.isArray(payload.replyTargetIds)
        ? payload.replyTargetIds
        : []
      ).slice(0, 24)) {
        const target = event.get(Number(seq), Math.min(before, row.time));
        if (!target) incomplete = true;
        if (target?.role === "user" && target.session_id === row.session_id)
          take(target);
      }
    }
  };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (seen.size >= 512)
      return { kind: "conversation", rooms: [], incomplete: true };
    const ref = queue[cursor];
    if (seen.has(ref)) continue;
    seen.add(ref);
    const kind = ref[0],
      id = ref.slice(2);
    if (kind === "m") {
      const row = event.get(Number(id), before);
      if (!row) incomplete = true;
      take(row);
      continue;
    }
    // Reading and her own executed activities are hers to introduce. Their
    // original motivation does not make the finished work someone else's chat.
    let rows = [];
    if (kind === "t")
      rows = db
        .prepare(
          "SELECT sources,parent_id FROM mind_thoughts WHERE id=? AND created<=? AND hidden=0",
        )
        .all(id, before);
    else if (kind === "s")
      rows = db
        .prepare(
          "SELECT sources FROM mind_self WHERE thread=? AND created<=? AND thread NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='self')",
        )
        .all(id, before);
    else if (kind === "g")
      rows = db
        .prepare(
          "SELECT sources FROM mind_meetings WHERE id=? AND created<=? AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='meeting')",
        )
        .all(id, before);
    else if (kind === "a")
      rows = db
        .prepare(
          "SELECT sources FROM mind_anticipations WHERE id=? AND created<=?",
        )
        .all(id, before);
    else if (kind === "d")
      rows = db
        .prepare("SELECT sources FROM mind_diary WHERE day=? AND created<=?")
        .all(id, before);
    if (["t", "s", "g", "a", "d"].includes(kind) && !rows.length)
      incomplete = true;
    for (const row of rows) {
      queue.push(...evidence(parse(row.sources, [])));
      if (row.parent_id) queue.push("t:" + row.parent_id);
    }
  }
  return {
    kind: rooms.size ? "conversation" : "own",
    rooms: [...rooms.values()].map((room) => ({
      ...room,
      people: [...room.people.values()],
    })),
    incomplete,
  };
}

export function originSummary(origin) {
  return {
    ...origin,
    rooms: origin.rooms
      .slice(0, 6)
      .map((room) => ({ ...room, people: room.people.slice(0, 8) })),
  };
}

export function initiativeAudience(mind, thought, session, now = Date.now()) {
  const sources = evidence(thought?.sources || []),
    before = Math.min(now, thought?.created || now);
  const origin = conversationOrigin(mind.db, sources, before);
  if (!mind.meetings.stays({ sources }, session, before))
    return {
      allowed: false,
      shared: false,
      origin,
      reason: "这份想法含有其他会话的私下来源，不能在这里继续",
    };
  if (origin.incomplete)
    return {
      allowed: false,
      shared: false,
      origin,
      reason: "话题来源缺失、已撤销或过长，参与者尚未核实",
    };
  if (!origin.rooms.length)
    return { allowed: true, shared: false, origin, mode: "new_topic" };
  let destination;
  try {
    destination = parseSessionKey(session);
  } catch {
    return {
      allowed: false,
      shared: false,
      origin,
      reason: "主动交流对象不明确",
    };
  }
  const aliases = new Set(scopedSessionAliases(mind.db, session));
  const shared = origin.rooms.some(
    (room) =>
      room.channel === destination.channel &&
      (destination.kind === "private"
        ? room.people.some((person) => person.id === destination.nativeId) ||
          (room.kind === "private" && aliases.has(room.sessionId))
        : aliases.has(room.sessionId)),
  );
  return {
    allowed: shared,
    shared,
    origin,
    mode: "continuation",
    ...(!shared
      ? {
          reason:
            "话题来自其他会话，当前对象未参与；保留想法，不继续向他接这个话题",
        }
      : {}),
  };
}
