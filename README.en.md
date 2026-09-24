# LuckyBot

LuckyBot is an AI companion that started in QQ group chats. She follows multi-person conversations on your machine, decides for herself when to join in and when to stay quiet, remembers people and events through long-term memory and a life of her own, and revisits what she used to think.

The current connector is OneBot 11. QQ login and delivery are handled by [NapCat](https://napneko.github.io/). LuckyBot does not store a QQ password. Models use a Chat Completions-compatible API.

**Language:** [English](README.en.md) · [简体中文](README.md)

## One of her

There is one of her across every group and private chat. You write her nature; her sense of self, who she is in each group and how she feels about each person grow from experience. Every change cites what caused it; you can inspect and revoke, but not rewrite. See the [design and usage guide (Chinese)](docs/她的一生.md).

- **She decides to speak.** No participation probability, no cooldown. When she reads a conversation she first appraises what it means to her, then chooses to speak, react briefly, say she'd rather not, or stay silent — and records why. Silence still moves her mood and her feelings about people.
- **Attention.** Being addressed, a private chat, or a possible crisis always gets read. Ordinary group chatter is read only when something draws her; otherwise she glances without spending tokens, and unread messages are read together next time.
- **A person is one person.** The same QQ number is the same person in every group. There is one memory: things learned elsewhere come up only when relevant, things told privately are not repeated in public, and secrets never leave where they were told.
- **Her days.** She sleeps (direct messages wait until she wakes, except a crisis), reflects when things are quiet, writes a diary before bed comparing herself with yesterday, sorts the day into memory at night, looks back every so often to rewrite the chapter she is in or start a new one, and may reach out to someone she has been thinking about — whether to say it is her own call.
- **Time leaves marks.** Threads, notes and memories nobody touches for a long time fade from her mind and come back when something brings them up (fading counts the days she actually lived, so a silent month does not wear her away). People who drift away grow distant and warm up again when they return. She remembers what others said was coming and what she promised, asks about it when the day comes, and knows when she missed it.
- **Tokens are accounted for.** One call does appraisal, feelings and words together; every call is recorded as conversation, inner life or upkeep; an optional daily cap with background shares makes her read only direct messages when it runs low.
- Messages close together are handled as one batch; documents can go into a knowledge base; replay never sends, never writes her mind, and only sees who she was at that moment.

## Requirements

- Windows, macOS, or Linux
- Node.js 24 or newer
- npm
- A model API key for real replies
- NapCat for a real QQ account; a dedicated account is recommended

## Start

```bash
git clone https://github.com/TodayYueC/LuckyBot.git
cd LuckyBot
npm install
npm run setup
npm start
```

Open <http://127.0.0.1:3210>. On Windows, `启动LuckyBot.cmd` starts the service and opens LuckyBot. `停止LuckyBot.cmd` stops this project's service.

`npm run setup` creates `.env` with an admin token and an OneBot token when the file is missing. An existing file is left unchanged.

```dotenv
HOST=127.0.0.1
PORT=3210
ADMIN_TOKEN=
ONEBOT_TOKEN=
LLM_API_KEY=
```

`ADMIN_TOKEN` protects LuckyBot and the HTTP API. `ONEBOT_TOKEN` protects `/onebot/v11/ws`. `LLM_API_KEY` is optional and, when set, overrides the key saved in LuckyBot. Restart after changing `.env`. Do not commit real secrets.

Simulation mode is the default. Add a group or QQ number under Conversation → Session settings, then send a simulated message from the live page. Simulation does not send to QQ. Without an API key it uses a local sample and does not call a model.

## Connect QQ

1. Under System → QQ connection, use the bundled installer or choose an existing NapCat directory.
2. Write the connection config, launch NapCat, and finish QQ login in the NapCat window.
3. Under System → Models, set the API URL, model name, and key, then run the connection test.
4. On Today, turn simulation off and keep global participation enabled.
5. Enable the target group or private chat in Session settings.

For a manual NapCat reverse WebSocket client:

```text
ws://127.0.0.1:3210/onebot/v11/ws
```

Use OneBot 11, array message format, and `ONEBOT_TOKEN`. The port is `PORT` from `.env`.

## Interface

| Section | Page | Use |
| --- | --- | --- |
| Today | `#overview` | Connection, active sessions, recent decisions, global switch, simulation |
| Conversation | `#live` | Live messages, decisions, cited knowledge, simulated chat |
| Conversation | `#spaces` | Add, pause, archive, and delete sessions; model, vision, aggregation, context, reply length |
| Conversation | `#lab` | Isolated replay by message sequence |
| Her | `#her` | Now, self, bonds, life, nature; a preview chat through the real pipeline |
| Memory | `#knowledge` | What she remembers (source, discretion, revoke), documents, retrieval test |
| System | `#models` | Model profiles, budgets, vision, embeddings, connection test |
| System | `#connect` | NapCat install, configuration, launch, and readiness |

Saved settings apply on the next turn. Closing the browser does not stop the service.

## Data

The server listens on `127.0.0.1` by default. Runtime files under `data/` are not committed:

```text
data/friend.db    Messages, memories, knowledge, and local settings
data/backups/     Database backups from npm run backup
data/*.log        Launcher and service logs
```

The database can contain chat text and model keys. Backups are private, and `.env` is not inside them. To restore, stop the service, move the current `friend.db` plus its `-wal` and `-shm` files aside, then copy the backup to `data/friend.db`. If `DB_PATH` is set, use that path.

Binding a non-local address requires `ADMIN_TOKEN`. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev:ui       # UI dev server; API proxied to port 3210
npm run build:ui     # Build into public/app for npm start
npm test             # includes a deterministic three-day life simulation
npm run test:ui      # studio smoke test and the 「她」 workbench in a browser
node scripts/evaluate-life.js   # a few days with your real model, report for reading (spends tokens)
npm run format:check
npm run docs:build   # Rebuild the web guide from docs/使用教程.md
```

Tests use temporary databases. They do not need a real key and do not send QQ messages.

```text
server/index.js      Process startup, auth, and wiring
server/channels/     Session identity, OneBot adapter, WebSocket
server/core/         Perception, context, one turn call, checks, delivery
server/mind/         Her mind: nature, affect, bonds, self, faces, memory, attention, bottom lines, token ledger, life
server/knowledge/    Documents and retrieval
server/studio/       HTTP for settings, NapCat, and model checks
studio-web/          Vue 3 UI
public/app/          Built UI
scripts/             Launch, stop, backup, guide build
tests/               Server and UI tests
vendor/napcat/       Verified NapCat Windows packages
```

## Documentation

- [Her life: design and usage (Chinese)](docs/她的一生.md)
- [Chinese guide](docs/使用教程.md)
- [Security](SECURITY.md)

## License

Project code is released under the [MIT License](LICENSE). NapCat packages in `vendor/napcat/` keep their upstream licenses.
