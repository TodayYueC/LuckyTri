import { parseSessionKey } from "./session-key.js";

export const CHANNEL_TYPES = ["onebot", "qqbot"];

// Which channel is wanted: the environment wins over the saved setting, the
// same way LLM_API_KEY wins over a key saved in the studio.
export function selectedChannel(store, env = process.env) {
  const forced = String(env.LUCKYTRI_CHANNEL || "")
    .trim()
    .toLowerCase();
  if (CHANNEL_TYPES.includes(forced)) return { type: forced, locked: true };
  const saved = String(store.settings().channel || "");
  return {
    type: CHANNEL_TYPES.includes(saved) ? saved : "onebot",
    locked: false,
  };
}

// Exactly one channel is connected at a time. Everything above the hub talks
// to it as if it were the channel itself, so the core, her mind and her life
// are the same whichever platform she is on; switching is a setting, not a
// restart.
export function createChannelHub(store, channels, { env = process.env } = {}) {
  const registry = new Map(channels.map((channel) => [channel.type, channel]));
  if (!registry.size) throw new Error("channel hub needs at least one channel");
  let active = null;
  let locked = false;

  const current = () => registry.get(active) || registry.values().next().value;

  // Bring the connected channel in line with the settings. Cheap when nothing
  // changed, so it is also what runs after the credentials are edited.
  function sync() {
    const wanted = selectedChannel(store, env);
    const type = registry.has(wanted.type)
      ? wanted.type
      : registry.keys().next().value;
    locked = wanted.locked;
    if (active && active !== type) registry.get(active).stop();
    const switched = active !== type;
    active = type;
    registry.get(type).start();
    if (switched)
      registry
        .get(type)
        .refreshDirectory()
        .catch(() => {});
    return type;
  }

  function attach(server, chat) {
    for (const channel of registry.values()) channel.attach(server, chat);
    sync();
  }

  // A room belongs to the channel it was met on. After a switch her old
  // rooms stay in the studio for reading, but nothing can be sent into them.
  function route(sessionId) {
    let channel = active;
    try {
      channel = parseSessionKey(sessionId).channel;
    } catch {
      /* A session without a channel key is spoken to over the active one. */
    }
    if (channel !== active)
      throw new Error("这个会话属于另一种 QQ 接入方式，当前不能向它发送");
    return current();
  }

  const send = async (message, text) => {
    if (message?.simulated) return { message_id: "sim" };
    return route(message.sessionId).send(message, text);
  };

  function canReach(sessionId) {
    try {
      return route(sessionId).canReach(sessionId);
    } catch {
      return false;
    }
  }

  function status() {
    const channel = current();
    const own = channel.status();
    const all = {};
    for (const item of registry.values()) all[item.type] = item.status();
    return {
      channel: channel.type,
      locked,
      online: !!own.online,
      connectedAt: own.connectedAt ?? null,
      lastEventAt: own.lastEventAt ?? null,
      lastDisconnectAt: own.lastDisconnectAt ?? null,
      adminProtected: !!env.ADMIN_TOKEN,
      port: Number(env.PORT || 3210),
      capabilities: channel.capabilities,
      ...all,
    };
  }

  return {
    attach,
    sync,
    send,
    canReach,
    status,
    type: () => current().type,
    online: () => !!current().status().online,
    fetchQuoted: (message) => current().fetchQuoted(message),
    fetchImage: (file) => current().fetchImage(file),
    refreshDirectory: () => current().refreshDirectory(),
    close() {
      for (const channel of registry.values()) channel.close();
    },
  };
}
