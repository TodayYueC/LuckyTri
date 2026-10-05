// A channel is the only part of LuckyTri that knows how a platform connects.
// Everything above it (sessions, attention, memory, time, her inner life) sees
// the same neutral message and talks back through the same few calls, so a
// new platform is one folder that fulfils this contract and one line in the
// registry (see channels/index.js).
//
//   type                 stable id, also the first part of every session key
//   capabilities         what the platform can express: mention, quote,
//                        image, thread, sticker
//   attach(server, chat) one-time wiring to the HTTP server and the ChatSystem
//   start()              begin accepting or opening the connection for the
//                        current settings; safe to call again after a change
//   stop()               drop the connection and stop timers; safe to repeat
//   send(message, text)  deliver one bubble; resolves { message_id }
//   fetchQuoted(message) the message that `message.replyId` points to, or null
//   fetchImage(file)     a fresh URL or bytes for an expired image, or null
//   fetchMedia(file, type)  optional: a voice or file the same way, or null
//   refreshDirectory()   learn real group and friend names; resolves a count
//   canReach(sessionId)  whether she may start a conversation there now
//   status()             { online, ... } for the connection panel
//   close()              final shutdown
//
// The message every channel hands to `ChatSystem.receive` is neutral. Besides
// the fields the core already uses, an adapter fills platformId, accountId,
// time, mentions, replyId and attachments itself, so nothing above the
// channel ever has to parse a platform's wire format.

const REQUIRED = [
  "start",
  "stop",
  "attach",
  "send",
  "fetchQuoted",
  "fetchImage",
  "refreshDirectory",
  "canReach",
  "status",
  "close",
];

export function defineChannel(channel) {
  if (!channel || typeof channel.type !== "string" || !channel.type)
    throw new TypeError("channel needs a type");
  for (const name of REQUIRED)
    if (typeof channel[name] !== "function")
      throw new TypeError(`channel ${channel.type} is missing ${name}()`);
  return Object.freeze({
    capabilities: {
      mention: false,
      quote: false,
      image: false,
      thread: false,
      sticker: false,
    },
    ...channel,
  });
}
