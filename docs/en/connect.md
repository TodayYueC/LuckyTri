<p align="right"><a href="../zh/connect.md">中文</a> · <b>English</b></p>

# Connecting QQ: two ways, one her

LuckyTri meets QQ through a "channel". A channel only handles how messages arrive and how they go out; **everything below the core — attention, memory, relationships, solitude, diary, time — is shared by both channels**. Changing how you connect does not change who she is: same nature, same memory, same behavior.

Only one channel is active at a time. Switch under "System → Connect QQ"; switching while running needs no restart. You can also pin it with the environment variable `LUCKYTRI_CHANNEL=onebot|qqbot`, after which the interface cannot change it.

## How to choose

| | OneBot 11 | QQ official bot |
| --- | --- | --- |
| What you need | An OneBot 11 connector of your own (with reverse WebSocket client support) and a QQ account | A bot on the QQ Open Platform: AppID and AppSecret |
| Direction | The connector connects to LuckyTri's `/onebot/v11/ws` | LuckyTri connects to the Open Platform's WebSocket gateway |
| Logging in to QQ | Done in the connector | Not needed |
| Group message scope | All group messages | All of them when "receive all messages" is enabled on the Open Platform; otherwise only messages that @ her |
| Names | Group names and nicknames are available | The official interface gives no group names and one-to-one nicknames are often empty; you can rename a session under "Chat" |
| Recognizing people across groups | By QQ number: the same person in every group and private chat | The same person has a different openid in each group; she can only tell it is one person when the platform provides a unified identity (`union_openid`) |
| Replying | Any time | Inside the passive-reply window (5 minutes in groups, 60 minutes in one-to-one) as a reply to the original message, each bubble with a rising sequence number; beyond it a proactive message is sent |
| Reaching out | No extra limits | Sent as proactive messages; when a person or group has turned the bot's proactive messages off, she waits for them to come to her |
| Images | Fetched through the connector | Attachment URLs go through the same vision path; only official media domains are allowed |

Neither is "more right". If you want every group message and don't mind running a connector, pick OneBot 11. If you would rather not log in to QQ or maintain a connector, pick the official bot and enable "receive all messages" on the Open Platform.

## OneBot 11

LuckyTri only implements the reverse-WebSocket side of OneBot 11 and ships no connector.

| Item | Value |
| --- | --- |
| Protocol | OneBot 11 |
| Reverse WebSocket URL | `ws://127.0.0.1:3210/onebot/v11/ws` (the port is your `PORT`) |
| Token | `ONEBOT_TOKEN` from `.env` |
| Message format | array |

When the connector is on another machine, replace `127.0.0.1` with an address that reaches LuckyTri and set `ADMIN_TOKEN` first. Session keys look like `onebot:<account>:group:<group id>` and `onebot:<account>:private:<QQ number>`; the early `group:<group id>` form is still recognized.

## QQ official bot

1. On the QQ Open Platform create a bot and note its **AppID** and **AppSecret**; enable group and one-to-one messages as the platform requires and add the bot to a test group or as a contact. The platform's entry points and review rules change over time; follow the Open Platform's current instructions.
2. Under "System → Connect QQ" choose "QQ official bot", enter the AppID and AppSecret and save. You can also set `QQBOT_APP_ID` and `QQBOT_APP_SECRET` in `.env` (environment variables win). The AppSecret is only stored; it is never sent back to the page.
3. The connection page shows the connection state, the bot's name and the time of the latest event. The group message scope reads "All group messages" or "Only messages that @ her"; for the latter, enable "receive all messages" on the Open Platform.

Session keys look like `qqbot:<AppID>:group:<group openid>` and `qqbot:<AppID>:private:<user openid>`.

### How she behaves on the official channel

- **@ and quotes**: whether she was @-ed comes from the platform's "is this the bot" flag; quoted content comes from the message elements carried by the event, and a quote of her own message counts as someone replying to her.
- **Replies and bubbles**: inside the window a reply carries the original message id and each bubble increments the sequence number; outside the window it is sent as a proactive message instead. When delivery is uncertain nothing is resent, exactly as with OneBot.
- **Reaching out and sharing**: before she reaches out she checks whether the person has turned proactive messages off; if so she does not send and waits for them to come to her. In one-to-one chats one wake-up per period is available as a fallback.
- **Names**: when a group name or one-to-one nickname is unavailable she uses a name already known, and otherwise a placeholder "QQ user · last four". Any session can be renamed under "Chat", on both channels.
- **Identity**: on the official platform the same person has a different openid in each group. Like someone who has only met another person in separate rooms, she will not treat the two as one person until the platform provides a unified identity. This is deliberate, not a defect.
- **Images**: attachment URLs go to the same vision path; the official channel needs no directory refresh.

## What happens when you switch

- Switching drops the current connection; sessions from the previous method stay readable but can no longer be sent to.
- Memory, relationships, diary and self are untouched, because they belong to her and not to the channel.
- The two methods number people differently (QQ number vs openid). Her impression of a person follows that number, so after switching the same real person shows up as a new one.

## For developers: adding a channel

The channel contract lives in `server/channels/contract.js`: `type`, `capabilities`, `attach`, `start`, `stop`, `send`, `fetchQuoted`, `fetchImage`, `refreshDirectory`, `canReach`, `status`, `close`. A new channel is one folder that fulfils the contract, an adapter registered in `server/channels/adapters.js`, and one line in `createChannels` in `server/channels/index.js`; nothing above the core changes. The steps are in `docs/en/architecture.md`.
