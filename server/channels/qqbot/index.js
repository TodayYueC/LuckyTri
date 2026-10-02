import { WebSocket } from "ws";
import { defineChannel } from "../contract.js";
import { parseSessionKey } from "../session-key.js";
import { channelState } from "../state.js";
import { QQBotApi, QQBotError } from "./api.js";
import { qqbotCredentials } from "./credentials.js";
import {
  isPlaceholderName,
  normalize,
  openidOf,
  qqbot,
  quotedElement,
  quotedMessage,
} from "./adapter.js";
import { QQBotGateway } from "./gateway.js";

// The platform's windows for answering a message without it counting as a
// proactive one. A little margin is kept off both so a late reply is sent as a
// proactive message instead of being refused.
const WINDOW = { group: 5 * 60000 - 15000, private: 60 * 60000 - 60000 };
const REPLIES = { group: 5, private: 4 };
const WAKEUP_EVERY = 30 * 86400000;
const REMEMBER = 2000;

// Answers that mean the message id cannot be used (any more) as a passive reply.
const EXPIRED = new Set([304103, 40034005, 40034128, 40034024]);
// The person or room has not allowed proactive messages.
const NOT_ALLOWED = new Set([40034105]);
const EXPLAIN = new Map([
  [40034100, "主动消息太频繁，平台暂时限制了发送"],
  [40034105, "对方或这个群没有开启机器人的主动消息"],
  [40034101, "机器人已不在这个群里"],
  [40054003, "机器人已不在这个群里"],
  [40054002, "机器人在这个群里被禁言"],
  [40054007, "消息太长，平台没有接收"],
  [40054010, "平台不允许发送链接"],
  [40034006, "消息内容没有通过平台审核"],
  [40054016, "机器人已下线，请检查机器人状态"],
]);

function bounded(map, key, value, limit = REMEMBER) {
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

// The QQ 开放平台 channel: she connects out to the platform's gateway with an
// AppID and AppSecret, instead of waiting for a OneBot client to connect in.
// Everything above the channel is shared with OneBot.
export function createQqBotChannel(
  store,
  {
    fetch,
    WebSocketImpl = WebSocket,
    now = Date.now,
    apiBase,
    tokenUrls,
    backoff,
    timeoutMs,
    env = process.env,
  } = {},
) {
  const state = channelState(store.db);
  const seen = new Map();
  const passive = new Map();
  const latest = new Map();
  const quotes = new Map();
  const botRefs = new Set();
  const names = new Map();
  let chat = null;
  let api = null;
  let gateway = null;
  let creds = qqbotCredentials(store, env);
  let signature = "";
  let connection = { state: "idle", error: "" };
  let botId = "";
  let botName = "";
  let connectedAt = null;
  let lastEventAt = null;
  let lastDisconnectAt = null;
  let sawAllGroupMessages = false;
  let sawAtOnlyGroupMessages = false;

  const key = (kind, id) => `${kind}:${creds.appId}:${id}`;

  function knownName(person) {
    if (names.has(person)) return names.get(person);
    let name = "";
    try {
      const row = store.db
        .prepare(
          "SELECT json_extract(payload,'$.name') name FROM core_events WHERE role='user' AND json_extract(payload,'$.userId')=? ORDER BY seq DESC LIMIT 20",
        )
        .all(person)
        .find((item) => item.name && !isPlaceholderName(item.name));
      name = row?.name || "";
    } catch {
      /* The core tables may not exist yet. */
    }
    names.set(person, name);
    return name;
  }

  function roomOf(type, d) {
    if (type.startsWith("GROUP_") && d?.group_openid)
      return `qqbot:${creds.appId}:group:${d.group_openid}`;
    const openid = String(d?.openid || "");
    if (!openid) return "";
    const person = state.get(key("person", openid)) || openid;
    return `qqbot:${creds.appId}:private:${person}`;
  }

  function permission(type, d) {
    const room = roomOf(type, d);
    if (!room) return;
    if (/_(REJECT|DEL_ROBOT|DEL)$/.test(type))
      state.set(key("closed", room), type);
    else state.delete(key("closed", room));
  }

  function inbound(type, d) {
    const id = String(d?.id ?? "");
    if (!id || seen.has(id)) return;
    bounded(seen, id, true);
    const person = String(d?.author?.union_openid || "");
    const message = normalize(type, d, {
      appId: creds.appId,
      botId,
      botRefs,
      knownName,
    });
    if (!message) return;
    if (
      type === "GROUP_MESSAGE_CREATE" &&
      !(d.mentions || []).some((u) => u?.is_you)
    )
      sawAllGroupMessages = true;
    if (type === "GROUP_AT_MESSAGE_CREATE") sawAtOnlyGroupMessages = true;
    const openid = openidOf(type, d);
    if (message.kind === "private" && person && person !== openid) {
      state.set(key("openid", message.userId), openid);
      state.set(key("person", openid), message.userId);
    }
    if (d.author?.username && !isPlaceholderName(message.name))
      names.set(message.userId, message.name);
    const entry = {
      msgId: id,
      session: message.sessionId,
      kind: message.kind,
      at: now(),
      seq: 0,
      expired: false,
    };
    bounded(passive, message.platformId, entry);
    if (message.platformId !== id) bounded(passive, id, entry);
    latest.set(message.sessionId, entry);
    if (message.replyId) {
      const element = quotedElement(d, message.replyId);
      if (element) bounded(quotes, message.replyId, element);
    }
    chat?.receive(message);
  }

  function onDispatch(type, d) {
    lastEventAt = now();
    switch (type) {
      case "GROUP_AT_MESSAGE_CREATE":
      case "GROUP_MESSAGE_CREATE":
      case "C2C_MESSAGE_CREATE":
        return inbound(type, d);
      case "C2C_MSG_REJECT":
      case "C2C_MSG_RECEIVE":
      case "GROUP_MSG_REJECT":
      case "GROUP_MSG_RECEIVE":
      case "GROUP_ADD_ROBOT":
      case "GROUP_DEL_ROBOT":
      case "FRIEND_ADD":
      case "FRIEND_DEL":
        return permission(type, d);
      default:
    }
  }

  function onState(next) {
    if (next.state === "ready") {
      botId = String(next.user?.id || botId || "");
      botName = String(next.user?.username || botName || "");
      connectedAt = now();
      connection = { state: "ready", error: "" };
    } else if (next.state === "closed") {
      lastDisconnectAt = now();
      connection = { state: "closed", error: connection.error };
    } else if (next.state === "error") {
      connection = { state: "error", error: next.error || "" };
      if (next.fatal) lastDisconnectAt = now();
    } else connection = { state: next.state, error: "" };
  }

  function usable(entry, kind) {
    return (
      !!entry &&
      !entry.expired &&
      now() - entry.at < WINDOW[kind] &&
      entry.seq < REPLIES[kind]
    );
  }

  function passiveFor(message, kind) {
    const direct = passive.get(String(message.platformId || ""));
    if (direct?.session === message.sessionId && usable(direct, kind))
      return direct;
    const recent = latest.get(message.sessionId);
    return usable(recent, kind) ? recent : null;
  }

  function explain(error) {
    if (error instanceof QQBotError && EXPLAIN.has(error.code))
      error.message = EXPLAIN.get(error.code);
    return error;
  }

  async function sendActive(post, route, body, session) {
    try {
      return await post(body);
    } catch (error) {
      if (NOT_ALLOWED.has(error?.code)) {
        state.set(key("closed", session), "NOT_ALLOWED");
        // One recall message per person each cycle is the platform's own
        // way back to someone who has stopped hearing from her.
        const wakeKey = key("wakeup", route.nativeId);
        const last = Number(state.get(wakeKey, 0));
        if (route.kind === "private" && now() - last > WAKEUP_EVERY) {
          state.set(wakeKey, now());
          try {
            return await post({ ...body, is_wakeup: true });
          } catch (again) {
            throw explain(again);
          }
        }
      }
      throw explain(error);
    }
  }

  async function send(message, text) {
    if (message.simulated) return { message_id: "sim" };
    if (!gateway?.ready || !api) throw new Error("QQ 官方机器人尚未连接");
    const route = parseSessionKey(message.sessionId);
    if (route.channel !== "qqbot" || route.accountId !== creds.appId)
      throw new Error("这个会话不属于当前连接的 QQ 官方机器人");
    const to =
      route.kind === "group"
        ? route.nativeId
        : state.get(key("openid", route.nativeId)) || route.nativeId;
    const post = (body) =>
      route.kind === "group" ? api.sendGroup(to, body) : api.sendUser(to, body);
    const body = { msg_type: 0, content: text };
    let result = null;
    const anchor = passiveFor(message, route.kind);
    if (anchor) {
      // The sequence number is spent before the request: if the answer never
      // comes, the same number can never be sent twice.
      anchor.seq += 1;
      try {
        result = await post({
          ...body,
          msg_id: anchor.msgId,
          msg_seq: anchor.seq,
        });
      } catch (error) {
        if (!EXPIRED.has(error?.code)) throw explain(error);
        anchor.expired = true;
      }
    }
    result ||= await sendActive(post, route, body, message.sessionId);
    const ref = String(result?.ext_info?.ref_idx || "");
    if (ref) {
      botRefs.add(ref);
      while (botRefs.size > REMEMBER)
        botRefs.delete(botRefs.values().next().value);
    }
    return { message_id: ref || String(result?.id || ""), id: result?.id };
  }

  async function fetchQuoted(message) {
    const element = quotes.get(String(message.replyId || ""));
    return element ? quotedMessage(message, element, { botId, botRefs }) : null;
  }

  function canReach(sessionId) {
    if (!gateway?.ready) return false;
    let route;
    try {
      route = parseSessionKey(sessionId);
    } catch {
      return false;
    }
    if (route.channel !== "qqbot" || route.accountId !== creds.appId)
      return false;
    if (usable(latest.get(sessionId), route.kind)) return true;
    return !state.get(key("closed", sessionId));
  }

  function stopConnection() {
    gateway?.stop();
    gateway = null;
    api = null;
    signature = "";
    connection = { state: "idle", error: "" };
  }

  function start() {
    creds = qqbotCredentials(store, env);
    if (!creds.appId || !creds.secret) {
      stopConnection();
      connection = { state: "unconfigured", error: "" };
      return;
    }
    const next = `${creds.appId}\n${creds.secret}`;
    if (gateway && next === signature) return gateway.start();
    stopConnection();
    signature = next;
    botId = "";
    botName = "";
    api = new QQBotApi({
      appId: creds.appId,
      secret: creds.secret,
      fetch,
      apiBase,
      tokenUrls,
      now,
      timeoutMs,
    });
    gateway = new QQBotGateway({
      api,
      onDispatch,
      onState,
      WebSocketImpl,
      now,
      backoff,
    });
    gateway.start();
  }

  function status() {
    const current = qqbotCredentials(store, env);
    return {
      type: "qqbot",
      online: !!gateway?.ready,
      configured: !!(current.appId && current.secret),
      appId: current.appId,
      secretConfigured: !!current.secret,
      appIdFromEnv: current.appIdFromEnv,
      secretFromEnv: current.secretFromEnv,
      state: connection.state,
      error: connection.error,
      botName,
      connectedAt,
      lastEventAt,
      lastDisconnectAt,
      // What the platform has actually delivered. Without "receive all
      // messages" switched on in the platform's console, only messages that
      // mention her arrive.
      groupMessages: sawAllGroupMessages
        ? "all"
        : sawAtOnlyGroupMessages
          ? "mentions"
          : "unknown",
      closedRooms: state.list(`closed:${current.appId}:`).length,
      adminProtected: !!env.ADMIN_TOKEN,
    };
  }

  return defineChannel({
    type: "qqbot",
    capabilities: qqbot.capabilities,
    attach(_server, chatSystem) {
      chat = chatSystem;
    },
    start,
    stop: stopConnection,
    send,
    fetchQuoted,
    fetchImage: async () => null,
    refreshDirectory: async () => 0,
    canReach,
    status,
    close: stopConnection,
  });
}
