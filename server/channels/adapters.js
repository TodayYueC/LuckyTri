import { onebot } from "./onebot/adapter.js";
import { qqbot } from "./qqbot/adapter.js";
import { parseSessionKey } from "./session-key.js";

// What the core may ask a platform without being connected to it, such as
// which media links are safe to download. One entry per channel type.
const adapters = new Map([
  [onebot.type, onebot],
  [qqbot.type, qqbot],
]);

export function registerChannel(adapter) {
  adapters.set(adapter.type, adapter);
}

export function adapterFor(sessionOrType = "onebot") {
  try {
    const type = String(sessionOrType).includes(":")
      ? parseSessionKey(sessionOrType).channel
      : sessionOrType;
    return adapters.get(type) || onebot;
  } catch {
    return onebot;
  }
}

export { onebot, qqbot };
