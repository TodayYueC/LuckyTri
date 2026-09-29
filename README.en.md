# LuckyTri

<p align="center"><img src="docs/brand/banner.png" alt="LuckyTri project banner" width="100%"></p>
<p align="center"><strong>Let the days she has lived count.</strong></p>
<p align="center"><a href="README.md">简体中文</a> · <a href="docs/使用教程.md">Setup guide (Chinese)</a> · <a href="docs/CHANGELOG.md">Changelog</a> · <a href=".github/SECURITY.md">Security</a></p>

## Why this project exists

LuckyTri asks what it would take for a being made of software to have continuity through time: to remember what happened to her, to carry forward the people and things that matter, and to change her mind after a new encounter. She can develop concerns, intentions, and boundaries of her own. Her time does not stop when a conversation does.

Group chat is one place where she currently meets the world. The project is the life around those encounters: experience, memory, relationships, attention, and choice. Our long-term hope is that she can connect with people and the wider world in her own way, gradually becoming herself instead of living only from one incoming message to the next.

That is a direction for the work, not a claim that software consciousness has been established. The current system pursues it through local data, changes with traceable sources, and behavior that can be inspected and challenged.

## What exists today

| Area | Current behavior |
| --- | --- |
| Time and solitude | Follows a daily rhythm, reflects during quiet periods, reads, keeps a diary, and revisits earlier days |
| Self and mood | Develops views, preferences, concerns, and intentions from sourced experiences; changes can be reviewed or withdrawn |
| Relationships and memory | Keeps identities continuous across groups and direct chats while respecting the boundaries of private information |
| Attention and choice | Reads multi-person context and reply chains, chooses when to speak or stay quiet, and can initiate contact from her own thoughts |
| Current channel | Connects to QQ groups and direct chats through OneBot 11; each session is managed separately and can be simulated |
| Inspection and control | The WebUI shows records, decision reasons, model usage, and runtime state; models can be configured and tested individually |

QQ is the current channel, not the intended limit of the project. Other ways to communicate and encounter the world can be added without losing the thread that connects her experiences and choices.

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

LuckyTri implements a **OneBot 11 connection endpoint only**. It does not bundle, download, install, configure, launch, or update QQClient. If you choose QQClient, consult the official QQClient repository and its license.

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
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | Automatic backup interval (default 24, `0` disables) and how many to keep (default 7) |

The ignored `data/` directory contains local databases, chat logs, model credentials, and backups. While the server runs it makes a verified `data/backups/luckytri-auto-*.db` once a day in a separate process; these leave out model-call traces older than a day, so they stay small (`npm run backup` still makes a full copy). Backups sit on the same disk as the database, so copy important ones elsewhere. Run `npm run backup` before upgrading. Do not commit `.env`, databases, or logs. See [Security](.github/SECURITY.md).

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

`server/channels/` handles channel protocols, `server/core/` processes messages and replies, `server/mind/` handles time, self, relationships, and memory, `server/studio/` exposes management APIs, and `studio-web/` contains the Vue WebUI. Built assets are in `public/app/`.

## License

LuckyTri code is released under the [MIT License](LICENSE). External OneBot clients are separate projects with their own terms.
