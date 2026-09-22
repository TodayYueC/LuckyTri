# LuckyBot

LuckyBot is a local-first QQ companion. It receives group and private messages on your machine, decides whether to speak, then writes a reply from the current batch, quote chain, persona, memories, and knowledge base.

The current connector is OneBot 11. QQ login and delivery are handled by [NapCat](https://napneko.github.io/). LuckyBot does not store a QQ password. Models use a Chat Completions-compatible API.

**Language:** [English](README.en.md) · [简体中文](README.md)

## What it does

- Private chats, mentions, name calls, and quotes of its own messages are answered directly. Ordinary group messages are judged in context, then sampled with a participation probability.
- Messages that arrive close together are handled as one batch.
- Long-term memories stay scoped to a session, a private chat, or a shared pool. An explicit “remember …” request becomes a candidate and is used only after review.
- Documents can be stored in a knowledge collection. Retrieved passages enter the context as data and do not skip the speech decision.
- The studio shows the live conversation and edits sessions, persona, models, and the QQ connection. Historical replay does not send QQ messages or write production memory.

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

Open <http://127.0.0.1:3210>. On Windows, `启动LuckyBot.cmd` starts the service and opens the studio. `停止LuckyBot.cmd` stops this project's service.

`npm run setup` creates `.env` with an admin token and an OneBot token when the file is missing. An existing file is left unchanged.

```dotenv
HOST=127.0.0.1
PORT=3210
ADMIN_TOKEN=
ONEBOT_TOKEN=
LLM_API_KEY=
```

`ADMIN_TOKEN` protects the studio and HTTP API. `ONEBOT_TOKEN` protects `/onebot/v11/ws`. `LLM_API_KEY` is optional and, when set, overrides the key saved in the studio. Restart after changing `.env`. Do not commit real secrets.

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

## Studio

| Section | Page | Use |
| --- | --- | --- |
| Today | `#overview` | Connection, active sessions, recent decisions, global switch, simulation |
| Conversation | `#live` | Live messages, decisions, cited knowledge, simulated chat |
| Conversation | `#spaces` | Add, pause, archive, and delete sessions; model, probability, cooldown, aggregation |
| Conversation | `#lab` | Isolated replay by message sequence |
| Memory | `#knowledge` | Session memories, review candidates, documents, retrieval test |
| Persona | `#character` | Persona, voice, prompts, and isolated preview |
| System | `#models` | Model profiles, budgets, vision, embeddings, connection test |
| System | `#connect` | NapCat install, configuration, launch, and readiness |

Saved studio settings apply on the next turn. Closing the browser does not stop the service.

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
npm run dev:ui       # Studio dev server; API proxied to port 3210
npm run build:ui     # Build into public/app for npm start
npm test
npm run test:ui
npm run format:check
npm run docs:build   # Rebuild the web guide from docs/使用教程.md
```

Tests use temporary databases. They do not need a real key and do not send QQ messages.

```text
server/index.js      Process startup, auth, and wiring
server/channels/     Session identity, OneBot adapter, WebSocket
server/core/         Context, speech decision, generation, delivery
server/knowledge/    Memories, documents, retrieval
server/studio/       HTTP for settings, NapCat, and model checks
studio-web/          Vue 3 studio
public/app/          Built studio
scripts/             Launch, stop, backup, guide build
tests/               Server and UI tests
vendor/napcat/       Verified NapCat Windows packages
```

## Documentation

- [Chinese guide](docs/使用教程.md)
- [Security](SECURITY.md)

## License

Project code is released under the [MIT License](LICENSE). NapCat packages in `vendor/napcat/` keep their upstream licenses.
