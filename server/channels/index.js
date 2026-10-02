import { createOneBotChannel } from "./onebot/index.js";
import { createQqBotChannel } from "./qqbot/index.js";

// Adding a platform: write a folder that fulfils channels/contract.js, give its
// adapter an entry in adapters.js (so the core can ask what its media links
// look like) and its factory a line in createChannels. Nothing above the hub
// changes.
export function createChannels(store, options = {}) {
  return [createOneBotChannel(store), createQqBotChannel(store, options.qqbot)];
}

export { createChannelHub, selectedChannel, CHANNEL_TYPES } from "./hub.js";
export { defineChannel } from "./contract.js";
export { adapterFor, registerChannel, onebot, qqbot } from "./adapters.js";
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
export { normalize } from "./onebot/adapter.js";
