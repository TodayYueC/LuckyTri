<p align="right"><a href="../zh/qq-official-bot.md">中文</a> · <b>English</b></p>

# QQ official bot: what it can do, and how LuckyTri talks to it

Survey date: 2026-10-29. This is the QQ Open Platform bot, not the OneBot connector already in use. Production stays on OneBot. The notes below are the `offbot` exploration. They do not claim the official API can replace that connector.

Pages checked:

- [QQ Bot introduction](https://bot.qq.com/wiki/) (marked updated 2026-10-21)
- [API call guide](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html) (origin `https://api.bot.qq.com`)
- [Events](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) (marked updated 2026-09-11)
- [Message overview](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)
- [Send message](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html) (still prints the 2025-04-21 proactive-push shutdown, plus a 2026-01-10 wake-up note and a 2026-03-05 sandbox note)
- [Send C2C message](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)
- [Full group message](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)
- [Group bot state](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)

Those pages disagree about proactive sends. Each number below names its source. When they conflict, the experiment should follow the stricter one.

## Result

The official bot **cannot** do what LuckyTri currently does through the OneBot connector: speak first whenever she wants, listen to ordinary group chat, send images and voice reliably, or treat one QQ number as one person.

The smallest experiment it **can** support: WebSocket in the console, the creator adds the bot as a friend or to a group they own or administer, the human sends one text message first, and LuckyTri replies with one plain-text message inside the passive window. About 5 minutes in a group, about 60 minutes in a one-to-one chat. Do not treat anything outside that window as "she can still start a conversation".

OneBot remains the default. With `LUCKYTRI_CHANNEL` unset or set to `onebot`, this path does not connect.

## Auth

| Item | Current behavior |
| --- | --- |
| Credentials | AppID and AppSecret. `QQBOT_APP_ID` / `QQBOT_APP_SECRET` win over values saved in the studio. The secret is never shown back. |
| Access token | `POST https://bots.qq.com/app/getAppAccessToken` with JSON `appId` and `clientSecret`. Response: `access_token` and `expires_in` (often 7200 seconds, sometimes a string). |
| Header | `Authorization: QQBot {access_token}`. Not `Bearer`, and not the old `Bot {token}`. |
| Refresh | During the last minute the previous token still works. LuckyTri refreshes when less than 90 seconds remain, and retries once after a 401. |
| OpenAPI | `https://api.bot.qq.com`. Override with `QQBOT_API_BASE` only for an experiment. |
| IP allow list | Up to 50 individual IPv4 addresses, no CIDR. Empty means every source is allowed. After it is set, only listed addresses can call OpenAPI. A missing address fails token, gateway and send; the connection page should show an error, not a quiet "connected". |

Sandbox: the send page says sandbox sends ignore rate limits. The current api-v2 guide does not name a sandbox host (older notes often use `https://sandbox.api.sgroup.qq.com`). This branch does not switch to sandbox by itself. Set `QQBOT_API_BASE` only on a throwaway instance, and follow the console.

## How events arrive

In the console, **WebSocket and Webhook are mutually exclusive and the switch takes effect immediately**. The wrong side is silence: the gateway can be READY while no user message ever arrives.

| | WebSocket (LuckyTri default) | Webhook (opt-in) |
| --- | --- | --- |
| Direction | LuckyTri connects to the URL from `GET /gateway` | The platform POSTs to your HTTPS endpoint |
| Fits | A single machine with no public ingress | A service that already has HTTPS |
| Ports | Outbound is enough | Only 80, 443, 8080, 8443 |
| Auth | Identify with `token`, `intents`, `shard` | Address check op=13; events need `X-Signature-Ed25519` |
| Env | `QQBOT_TRANSPORT` unset or `websocket` | `QQBOT_TRANSPORT=webhook`, path `/qqbot/webhook` by default |

WebSocket: Hello (op 10) → Identify (op 2) → READY → heartbeat (op 1 / op 11). Resume (op 6) replays after a short drop. Close codes 4914 and 4915 stop retrying.

The subscribed intent is only `GROUP_AND_C2C_EVENT` (`1 << 25`). The 2026-09-11 intent list puts these on that bit:

- `C2C_MESSAGE_CREATE`
- `GROUP_AT_MESSAGE_CREATE`
- `FRIEND_ADD` / `FRIEND_DEL`
- `C2C_MSG_REJECT` / `C2C_MSG_RECEIVE`
- `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT`
- `GROUP_MSG_REJECT` / `GROUP_MSG_RECEIVE`

`GROUP_MESSAGE_CREATE` (every group message) is **absent** from that September list, but its own event page says it uses `1 << 25` and is pushed only after "receive all messages" is on. LuckyTri already parses it. If it never arrives, the missing piece is the console or group receive setting, not another intent bit. Subscribing to an intent the bot is not allowed to use closes the socket, so guild, forum and audio bits are left off.

Guild events (`AT_MESSAGE_CREATE`, `MESSAGE_CREATE`, `DIRECT_MESSAGE_CREATE`) are a separate surface. This channel does not handle them.

Identity:

- A one-to-one user is `user_openid`, a group member is `member_openid`, a group is `group_openid`.
- Openids differ per bot.
- The same person has a different `member_openid` in each group. LuckyTri merges them only when `union_openid` is present. It is often empty.
- The platform does not give group names, and one-to-one nicknames are often empty. Rename the session under Chat.

`GET /v2/groups/{group_openid}/bot_state` can report `recv_msg_setting` as `all`, `only_mention` or `mention_and_context`. The page says non-allow-listed bots get error `11253`. This branch does not call it. It infers scope from traffic: a non-mention `GROUP_MESSAGE_CREATE` means "all", and only `GROUP_AT_MESSAGE_CREATE` means "mentions".

## Sending

- One-to-one: `POST /v2/users/{user_openid}/messages`
- Group: `POST /v2/groups/{group_openid}/messages`

`msg_type` 0 is text, 2 Markdown, 3 Ark, 4 embed, 7 rich media after an upload that returns `file_info`. Keyboards use `keyboard`. This branch **sends type 0 only**. Markdown, buttons, Ark, images, voice and files are rejected locally so a half-built body is not posted.

A passive reply carries the event's `d.id` as `msg_id`, and each bubble increments `msg_seq`. The same pair cannot be sent twice. Duplicate deliveries are dropped by message id. The sequence number is spent before the request returns.

| Scene | Passive window | Replies per message | Source |
| --- | --- | --- | --- |
| Group | 5 minutes | 5 | Overview and send pages |
| One-to-one | 60 minutes | Overview and the generated C2C page say **4**. The send page says **5**. | Conflict. LuckyTri uses 4, then treats the next bubble as proactive. |

The code keeps a margin (15 seconds off the group window, 1 minute off the one-to-one window). After the window, or when the platform says the id expired (`40034005` and similar), the existing path sends a **proactive** message with no `msg_id`.

Proactive send is the part that cannot be trusted:

| Claim | Source |
| --- | --- |
| Proactive push stopped on 2025-04-21 and calls return an error | Banner still on the send page in October 2026 |
| 4 proactive messages per user per month, and 4 per group per month | Body of that same page |
| C2C wake-up: after the user has talked to the bot, one message in each of 4 cycles inside 30 days, via `is_wakeup` | 2026-01-10 note; mutually exclusive with `msg_id` |
| Certified bots: 10 QPS and 1000 C2C messages per user per day; groups up to 1000 per group per day. Uncertified bots are lower. | Overview and the generated C2C page. Not the same order of magnitude as "4 per month" or "shut down". |
| The user or a group admin can disable proactive messages. LuckyTri treats `40034105` as that switch. | Send pages |

Set `QQBOT_PROACTIVE=passive` for the experiment. Outside the window LuckyTri refuses locally instead of calling an API that may already be shut down. The default remains `auto`, which is the previous behavior: try a proactive send, and in one-to-one try `is_wakeup` once per cycle after a refusal.

Rich media must be uploaded first. `file_info` expires, and one-to-one uploads are not valid in groups. Inbound image URLs already go through the existing vision path and only official media hosts are allowed. Outbound upload is not implemented.

URLs fail unless they were configured in the q.qq.com console.

## Who can message the bot

From the 2026-10-21 introduction:

- Unverified: the creator can add the bot only to groups they own or administer.
- Personal verification: not public, at most 500 groups.
- Enterprise verification: scenes can be public.
- Older personal bots that passed the previous public review can be public, with a group cap.

Creating the bot does not start a one-to-one chat. Someone has to add it or open the chat and send a message before `C2C_MESSAGE_CREATE` exists. `FRIEND_ADD` alone does not open a session.

Groups default to @-only delivery. Ordinary chat is invisible, so she cannot join it. That is different from the OneBot connector. After "receive all messages" is on, events reach the core, and her existing attention still decides whether to speak. A full event stream is not water-cooler chat.

## Why "connected" and silent is common

1. **The console is on Webhook while LuckyTri is on WebSocket**, or the reverse. READY, `dispatchCount` stays 0, no session appears. The switch is immediate.
2. **The bot is in no conversation.** Not in a group, not added as a friend. Unverified bots cannot join groups they do not administer.
3. **The group only pushes @.** The connection page then says mentions only. She looks absent during normal chat.
4. **The IP allow list omits this machine.** That usually looks like a connection or send error, not a quiet READY. An empty list allows every source.
5. **The reply missed the passive window.** A slow model, a late decision, or too many bubbles. Group: 5 minutes / 5 replies. One-to-one: 60 minutes / 4 replies. The proactive attempt after that is often rejected. `lastSendError` keeps the reason.
6. **Proactive messages were turned off, the bot was removed or muted, review failed, or the text contained an unconfigured link.** Those codes are translated in `EXPLAIN` inside `server/channels/qqbot/index.js`.
7. **The token was not refreshed.** The normal path refreshes early. A wrong secret is an error state, not a fake online state.
8. **She chose not to answer.** Same as OneBot: global or session switch, rest, rate limit, model failure, or a group line that was not addressed to her. The official path just makes "not addressed" the default.

The readiness line on Connect QQ says so when the gateway is ready and the event count is still 0. `hints` on the channel status is the same judgment.

## Capability matrix

| What LuckyTri needs | OneBot 11 | QQ official bot (2026-10) |
| --- | --- | --- |
| One-to-one text after the human speaks, inside the window | Yes | Yes. This is the smallest experiment. |
| Group reply after an @, inside the window | Yes | Yes. About 5 minutes and 5 replies. |
| Hear and sometimes join ordinary group chat | Yes, subject to her attention | No by default. With receive-all, events arrive and she may still stay quiet. |
| She speaks first, remembers overnight, shares a work | Yes | Unreliable. The docs say shut down, 4 per month, and a much higher QPS at the same time. Do not try this on the production persona. |
| C2C wake-up `is_wakeup` | Not used | Documented. The code tries it once per cycle after a proactive refusal. |
| Images, voice, files | The connector sends and receives them | Receive: attachment URLs enter vision. Send: upload is not wired; the call is rejected locally. |
| Markdown, buttons, Ark | Depends on the OneBot build | The platform has them. This branch does not send them. |
| Stickers, poke, recall, music cards | OneBot extensions; dropped when refused | Not offered on the official channel. |
| Group names, nicknames, friend list | Yes | No directory. Rename the session by hand. |
| One person across groups and private chat | QQ number | Usually different openids. Without `union_openid` they are different people. |
| Guild / text channel | Not this path | The platform has it. LuckyTri does not connect it. |
| Beside the OneBot connector in one process | This is the live path | No. `ChannelHub` runs one QQ channel at a time. |

## Where it plugs in

Official events and OneBot events become the same neutral message, then the same attention, memory, relationships, solitude, diary and time.

```
C2C_MESSAGE_CREATE
GROUP_AT_MESSAGE_CREATE  → normalize() → ChatSystem.receive(neutral message)
GROUP_MESSAGE_CREATE

text she decided to send → channel.send()
  inside the window: POST .../messages  { msg_type:0, content, msg_id, msg_seq }
  outside: same URL, no msg_id (local refusal when QQBOT_PROACTIVE=passive)
```

Session keys:

- `qqbot:<AppID>:private:<user openid or union_openid>`
- `qqbot:<AppID>:group:<group openid>`

OneBot keys look like `onebot:<account>:<private|group>:<QQ number>`. They do not match, so the same human becomes two people in memory.

| Variable | Role |
| --- | --- |
| `LUCKYTRI_CHANNEL` | `onebot` or `qqbot`. When set, the studio cannot change it. Unset uses the studio choice, default onebot. |
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | Credentials. They win over the studio. |
| `QQBOT_TRANSPORT` | `websocket` (default) or `webhook`. Must match the console. |
| `QQBOT_WEBHOOK_PATH` | Default `/qqbot/webhook`. |
| `QQBOT_PROACTIVE` | `auto` (default) or `passive`. |
| `QQBOT_API_BASE` | Optional. Default `https://api.bot.qq.com`. |

Code lives in `server/channels/qqbot/`: `credentials.js`, `api.js` (token and send), `gateway.js`, `webhook.js`, `adapter.js` (neutral message), `index.js` (channel contract), `silence.js`. Registration is still `server/channels/adapters.js` and `server/channels/index.js`. The core has no official-bot branch.

## Do not share the live OneBot persona

`ChannelHub` will not keep two QQ channels online. Switching disconnects the current one. Old sessions stay readable and cannot be sent to.

Two processes on one `data/friend.db` are worse: memory, relationships and self get torn. Official openids and QQ numbers are not the same key. Pointing the experiment at the production persona makes one human look like a stranger, or makes two transports speak for her at once.

Use a separate `LUCKYTRI_HOME`. Use a separate AppID. Do not point it at the Lightsail machines that are running the OneBot connector, and do not change the production OneBot address to try the official API.

## What this branch changed

Already present: token refresh, WebSocket gateway (heartbeat, resume, backoff), parsing and de-duplication of group @, full group and one-to-one events, the passive window and sequence numbers, remembering when proactive messages are turned off, and one `is_wakeup` per cycle.

Added here:

- `hints`, `dispatchCount`, `lastEventType` and `lastSendError` on status. Readiness explains a ready gateway with zero events (Webhook versus WebSocket, membership, allow list).
- With `QQBOT_TRANSPORT=webhook`, callback validation. The op=13 signature matches the documented vector, events check `X-Signature-Ed25519`, and the ack is `{ "op": 12, "d": 0 }`. The route is not mounted by default. OneBot's `/onebot/v11/ws` is unchanged.
- `QQBOT_PROACTIVE=passive`.
- Local refusal for rich media, Markdown, Ark and keyboards.

Not done: media upload, guilds, automatic sandbox host selection, a reliable proactive policy, or a studio control for receive mode. Receive mode is an environment variable so it stays out of the OneBot screen people already use.

## Smallest experiment

Use an empty data directory. Not the production database.

1. Create a bot and keep the AppID and AppSecret. You need to be able to add it as a friend, or to a small group you own or administer.
2. Set the console receive mode to **WebSocket**. Leave the IP allow list empty, or add this machine's public IPv4. Enable the one-to-one or group scene you want to try.
3. In `.env`:

```
LUCKYTRI_CHANNEL=qqbot
QQBOT_APP_ID=your-app-id
QQBOT_APP_SECRET=your-app-secret
QQBOT_TRANSPORT=websocket
QQBOT_PROACTIVE=passive
```

4. After start, open System → Connect QQ. The state should be connected and the bot name should show. The latest event can still say there is none.
5. From your own QQ, send the bot "在吗", or @ it in the test group. A session should appear within a few seconds. Her reply has to land inside the window and be plain text.
6. Talk in the group without an @. If the scope is still "mentions only", that is the platform. Do not expect water-cooler chat before "receive all messages" is on.
7. Wait out the one-to-one hour and ask her to speak first. With `passive` she will not send. Switch to `auto` only on this empty instance and read `lastSendError` if it fails. Keep the trace id in your own notes. Do not change the production channel to make her speak first.

Use `QQBOT_TRANSPORT=webhook` only when you already have public HTTPS and the console is set to Webhook. The callback looks like `https://your-domain/qqbot/webhook` on port 443. Without a public ingress, stay on WebSocket.

If step 5 still creates no session, read the readiness hints and the silence list above. A session plus one in-window text reply means this bot's path is open. It still does not mean she can live on the official API instead of the OneBot connector.
