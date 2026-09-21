import { onebot } from "./onebot.js";
import { parseSessionKey } from "./session-key.js";

const adapters = new Map([["onebot", onebot]]);

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

export { onebot };
export {
  bindSessionId,
  formatSessionKey,
  isGroupSession,
  parseSessionKey,
  publicSession,
  sessionAliases,
  sessionKind,
  sessionNativeId,
} from "./session-key.js";
export { normalize } from "./onebot.js";
