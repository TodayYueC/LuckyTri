# LuckyTri

<p align="center"><img src="docs/brand/banner.png" alt="LuckyTri project banner" width="100%"></p>
<p align="center"><strong>A locally run AI chat project with long-term memory, proactive conversations, and OneBot 11 connectivity.</strong></p>
<p align="center"><a href="README.md">简体中文</a> · <a href="docs/使用教程.md">Setup guide (Chinese)</a> · <a href="docs/CHANGELOG.md">Changelog</a> · <a href=".github/SECURITY.md">Security</a></p>

LuckyTri provides message handling, session management, memory, proactive messaging, and a WebUI. It can connect to QQ through OneBot 11 or run in a simulation mode. The aim is to preserve conversational context over time and across sessions. Model output should not be treated as human emotion or verified fact.

## Features

| Area | What it does |
| --- | --- |
| Groups and direct chats | Tracks speakers, quoted messages, and context; participation is configured per session |
| Speech decisions | Chooses when to reply or stay silent, with a short aggregation window and delivery tracking |
| Memory | Stores sourced information with cross-session retrieval, editing, and withdrawal |
| Proactive messaging | Can start a conversation from prior experiences and current interests when enabled |
| Models | Supports multiple Chat Completions-compatible profiles and per-model connection tests |
| WebUI | Shows live messages, usage, decisions, memory, and runtime status |

## Quick start

Requires Node.js 24.5+ and npm. For model-generated replies, bring your own compatible model service and API key.

```bash
git clone https://github.com/TodayYueC/LuckyTri.git
cd LuckyTri
npm install
npm run setup
npm start
```

Open <http://127.0.0.1:3210>. On Windows, `启动LuckyTri.cmd` and `停止LuckyTri.cmd` provide start and stop shortcuts. Configure and test a model under **System → Model library**, then try a simulated message under **Conversations**. Simulation does not send QQ messages.

## QQ connection

LuckyTri implements a **OneBot 11 connection endpoint only**. It does not bundle, download, install, configure, launch, or update NapCat. If you choose NapCat, consult the [official NapCat repository](https://github.com/NapNeko/NapCatQQ) and its license.

1. Set `ONEBOT_TOKEN` in the local `.env`; `npm run setup` generates a random token on first setup.
2. In an independently installed OneBot 11 client, enable a **reverse WebSocket client** and use **array** message format.
3. Set the address to `ws://127.0.0.1:3210/onebot/v11/ws` and use the same token.
4. Complete QQ login in the client. Check **System → QQ connection**, then enable the sessions you want under **Conversations**.

If the client runs elsewhere, replace `127.0.0.1` with an address that reaches LuckyTri and configure `ADMIN_TOKEN` for the management interface.

## Configuration and local data

`npm run setup` creates `.env` without overwriting an existing file.

| Variable | Purpose |
| --- | --- |
| `HOST` / `PORT` | HTTP binding; default `127.0.0.1:3210` |
| `ADMIN_TOKEN` | WebUI and HTTP API access |
| `ONEBOT_TOKEN` | OneBot WebSocket authentication |
| `LLM_API_KEY` | Optional; takes precedence over a WebUI-saved model key |

The ignored `data/` directory contains local databases, chat logs, model credentials, and backups. Run `npm run backup` before upgrading. Do not commit `.env`, databases, or logs. See [Security](.github/SECURITY.md).

## WebUI

| Page | Purpose |
| --- | --- |
| Now | Current status, recent activity, and usage |
| Mind | Internal notes and changes |
| People | Relationships and sources |
| Life | Diary, reflections, plans, and timeline |
| Conversations | Sessions, messages, simulation, and debugging |
| Memory | Long-term memory and reference material |
| Nature | Persona, schedule, and proactive messaging |
| System | OneBot status, models, and runtime controls |

## Development

```bash
npm run dev:ui       # WebUI development server
npm run build:ui     # Build the WebUI
npm test             # Backend tests
npm run test:ui      # Browser smoke tests
npm run format:check # Check code formatting
```

`server/channels/` handles OneBot, `server/core/` processes messages and replies, `server/mind/` handles memory and time state, `server/studio/` exposes management APIs, and `studio-web/` contains the Vue WebUI. Built assets are in `public/app/`.

## License

LuckyTri code is released under the [MIT License](LICENSE). External OneBot clients are separate projects with their own terms.
