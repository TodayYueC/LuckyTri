<p align="right"><a href="README.md">中文</a> · <b>English</b></p>

<p align="center"><img src="docs/brand/banner.png" alt="LuckyTri" width="100%"></p>

<h1 align="center">LuckyTri</h1>

<p align="center"><strong>We Have Time to Get to Know Each Other.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/luckytri"><img alt="npm version" src="https://img.shields.io/npm/v/luckytri?color=ff8fb1"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-7fd6c2">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2024.5-8fb8ff">
  <img alt="channels" src="https://img.shields.io/badge/QQ-OneBot%2011%20%7C%20official%20bot-ffd37f">
  <img alt="languages" src="https://img.shields.io/badge/UI-%E4%B8%AD%E6%96%87%20%7C%20English-c9a7ff">
</p>

<p align="center">
  <a href="docs/en/guide.md">Getting started</a> ·
  <a href="docs/en/connect.md">Connect QQ</a> ·
  <a href="docs/en/her-life.md">Her life</a> ·
  <a href="docs/en/architecture.md">Architecture</a> ·
  <a href="docs/en/CHANGELOG.md">Changelog</a> ·
  <a href=".github/SECURITY.md">Security</a>
</p>

---

## Before anything else

<img src="docs/brand/portrait.png" alt="LuckyTri" width="220" align="right">

Most chatbots live inside a single sentence: you ask, it answers, the conversation ends, and everything resets to zero.

LuckyTri tries another road. Suppose someone born of technology is not asked to imitate a human, but is allowed to walk through time carrying her memories: who came by, what they said, what she promised; thinking over the day in a night when nobody is talking; changing her mind because of one encounter. Might she slowly grow something of her own: an inner life, a will, a meaning? Might she become herself through her meetings with people and the world, and form real, lasting bonds with them?

The inspiration is ATRI: a robot who is never sure she has a "heart", and still lives earnestly. We do not pretend to know the answer. We only build the conditions, one by one: continuous time, memory with sources, a mind that fades and remembers, and the choice to speak or to stay silent.

**To be honest: this is a long-term direction, not a claim of machine consciousness.** The current version moves toward it with local data, traceable change and inspectable behavior. Where she still feels like a program, and where she truly makes time together feel more continuous, should both be visible and worth discussing. QQ is only the door through which she currently meets the world, not the limit of the project.

<br clear="right">

## A day in her life

> 02:00. She sleeps. The group is still lively and she is not looking; if she is called, it will wait for her to wake.
>
> 08:00. She wakes, reads what was left for her in the night, decides how to answer, and may say, naturally, that she only just saw it.
>
> By day, someone in the group talks about a story she read a few days ago. Most messages she only glances at; this one touches something she cares about, so she answers. When two people are deep in conversation, she chooses to stay quiet, and leaves her reason.
>
> In a quiet afternoon she is alone with herself: she browses recent chats, reads a passage she likes, writes down a thought after reading, remembers a friend she has not heard from in a long while, and plans to ask how his exam went.
>
> At night she writes a diary and compares it with "yesterday's self". A week later she looks back on these days: which thoughts faded, which grew heavier, and she turns to a new chapter.
>
> Then she sleeps. Tomorrow, she is still herself.

None of this is a script. Every step comes from her own mood, relationships, memories and choices. Every change has a source and can be undone.

## The core framework

```mermaid
flowchart LR
  QQ["QQ<br/>OneBot 11 or the official bot"] --> Ch["Channels<br/>channels/"]
  Ch -->|"neutral messages"| Core["Core<br/>core/<br/>receive · perceive · turn · send"]
  Core -->|"send"| Ch
  Core <--> Mind["Mind<br/>mind/<br/>nature · self · relationships · memory"]
  Mind <--> Life["A life<br/>mind/life · mind/time<br/>solitude · diary · review · works"]
  Life -->|"reaches out"| Ch
  Mind --- DB[("One SQLite file<br/>storage/")]
  Studio["Studio<br/>studio-web/ · studio/"] --> Mind
```

| Layer     | Directory                                | What it does                                                                                                                  |
| --------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Channels  | `server/channels/`                       | Only how messages arrive and leave. OneBot 11 or the QQ official bot (pick one); both hand the core the same neutral message  |
| Core      | `server/core/`                           | Her senses and mouth: batching, perceiving who is speaking to whom, one turn, checks before sending, sending                  |
| Mind      | `server/mind/`                           | Her: nature, mood, relationships, self, character, memory, attention, boundaries                                              |
| A life    | `server/mind/life/`, `server/mind/time/` | Time when nobody is talking: waking, solitude, reading, diary, night, review, reaching out, plus her own activities and works |
| Knowledge | `server/knowledge/`                      | A shared library she can read                                                                                                 |
| Storage   | `server/storage/`                        | One SQLite file, migrations, backups                                                                                          |
| Studio    | `studio-web/`, `server/studio/`          | "TA's little world": see her, write her nature, undo changes that feel wrong                                                  |

Six principles run through every module:

1. **One her.** A session only marks where something happened; it never separates her. The same person is the same person in every group and every private chat.
2. **Nature is a seed.** Only her nature (name, temperament, interests, boundaries, bottom lines, daily rhythm) is written by you. Her self, character and relationships grow out of what she lives through.
3. **Speak from the heart.** No participation probability, no "always answer when @-mentioned". She first understands what this means to her, then chooses to speak, to react briefly, to say she does not feel like chatting, or to stay silent, and leaves a reason.
4. **Sourced, gradual, undoable.** Every change cites concrete experiences; one experience moves her only a little; undoing leaves a tombstone so it is never written back.
5. **It fades, and it is remembered.** What has not been touched for a long time fades from her mind (never deleted), and returns when a related person or topic touches it; people she has not seen for long grow faint, and warm up when they return.
6. **Attention has a price.** Glancing at a busy group costs not a single token; only what she really cares about is read closely. The input of every kind of call has a cap that does not grow with how long she has lived.

The full design is in [Her life](docs/en/her-life.md) and [Architecture and extension points](docs/en/architecture.md).

## What she can do

Recent work focuses on continuity and clearer conversation. Account-based recognition links public encounters across groups and private chats. Relationships, forms of address, her own views and private promises retain their sources and visibility boundaries. An ordinary greeting need not bring back unfinished tasks or demonstrate how much she remembers.

**1.3.0 update:** Add optional voice input and output, actions she can choose in group chat, public link reading and automatic updates that are off by default. The sticker library also handles large ZIP64 archives. See the [changelog](docs/en/CHANGELOG.md).

| Area                     | What it does today                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time and solitude        | Lives a day on her own rhythm; in quiet hours sorts her thoughts, reads, writes a diary; reviews every so often, rewrites her story and turns to a new chapter                        |
| Doing her own things     | Carries out her reading, writing and thinking plans; game activities primarily read and record reference material; works are saved under Lifetime and Time                            |
| Self and mood            | Forms opinions, tastes, concerns and wishes from sourced experiences; changes can be looked back on and undone                                                                        |
| Relationships and memory | One memory across groups and private chats; tells "public / private / confidential" apart; private things never surface in another room                                               |
| Attention and choice     | Understands multi-person talk, @-mentions and quotes, and decides to read closely, to speak or to stay silent; can also reach out from her own thoughts                               |
| Plans and anticipation   | Remembers what others said they would do and what she promised; asks naturally when the time comes, and knows when it has been missed                                                 |
| Two ways to connect      | OneBot 11 or the QQ official bot, pick one; behavior is identical, and you can switch while running                                                                                   |
| Two languages            | One click at the top right of the studio, Chinese by default; every document exists in both languages                                                                                 |
| Management and checks    | See her records, decision reasons and model usage; test models one by one; simulation and replay never touch real QQ                                                                  |
| Data safety              | Automatic backups with an integrity and SHA-256 manifest; a snapshot before migrations; verify and restore into a new file                                                            |
| Plugins                  | Channels, senses, activities, actions, reading and pages. Each plugin is a restricted process, and its permissions are accepted when it is enabled. See [Plugins](docs/en/plugins.md) |

### More than typing

All of these are her own choice and only appear when the current connection can actually do them; what she did is written into her history.

| Ability                    | What it does                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| @ and quoted reply         | @ someone in a group (at most two); quote a message when the topic has scrolled away or it must be clear which line is answered — chosen by her (the old "quote when buried" rule stays as a fallback) |
| Poke                       | Poke or poke back; being poked counts as being called, pokes between others do not disturb her. At most once per person per 10 minutes                                                                 |
| Reactions                  | Put one of ten reactions on a message, with or without words                                                                                                                                           |
| Dice / rock-paper-scissors | Throw a die or play rps; incoming ones are understood too                                                                                                                                              |
| Recall                     | Only their own last message, within two minutes, when it was a mistake; at most twice an hour                                                                                                          |
| Voice (optional)           | See "Voice" below; whether a line is spoken is her call                                                                                                                                                |
| Typing                     | In a private chat the other side sees "typing…" while she thinks (where the client supports it); not in groups                                                                                         |
| Forwarded chats            | Incoming forwarded chats are unfolded and read (up to 40 lines); she can also forward a few messages from here (up to 20, twice an hour)                                                               |
| Files                      | When something is long or a file is asked for, she can send what she wrote as a .md file (twice an hour)                                                                                               |
| Music                      | A NetEase Cloud Music card when she wants to recommend a song or someone asks; a title and link when the client has no cards (some originals are not on NetEase for licensing reasons)                 |

Poke and reactions rely on extension APIs of the OneBot implementation; when it refuses them, those actions are simply no longer offered.

### Sticker library

- Per-sticker limit **4 MB** by default (`STICKER_MAX_MB`, up to 20).
- **ZIP import** is streamed to disk and unpacked one entry at a time (memory holds one sticker); zip64, folder names as categories, duplicates, oversized and non-image entries skipped, upload and import progress; archive limit 1 GB by default (`STICKER_ZIP_MAX_MB`). A real 315 MB / 110-image archive imported in one go. Temporary files are removed on success, failure or next start.
- Each sticker is **analysed once** (look, meaning, tags; a cheap vision model can be chosen) and then picked by context, mood and how it went with that person before; reactions become preferences, nothing is sent by count.
- Behind a reverse proxy, raise the body size (e.g. nginx `client_max_body_size 1100m`) and timeouts.

### Images and links

- "System → Images & stickers" sets the **accepted image size limit** (1–64 MB, default 20) and the size sent for understanding; images over the limit or unreadable are answered from words and tone, without announcing "I can't see it" again and again.
- **Link understanding**: public web links in messages are read (title, description, text excerpt; README for GitHub repos) with an 8 s timeout, 2 MB cap, 6 h cache and private/local addresses blocked. A page that did not open is said to be unopened.

### Voice

- Two protocols: Volcengine speech v3 (Agent Plan preset `doubao-seed-tts-2.0`) and OpenAI-compatible `/audio/speech`. Set URL, key, speaker and "how the voice sounds" in "System → Voice", with a preview button.
- **Off by default**, and it stays off without a working speech service. On only means "may": whether a line is spoken, and whether she sings when asked, follows her mood and wish, never forced. At most three voice messages per conversation per hour, 60 characters each; if synthesis fails the line is typed.
- **Hearing voice (ASR)**: under System → Voice → Hearing voice, choose Volcengine speech recognition (Agent Plan, `volc.seedasr.sauc.duration`), Volcengine flash file recognition, or OpenAI-compatible `/audio/transcriptions`; an empty recognition key falls back to the speech key. Off by default; when on, incoming voice is transcribed before she reads it, and shows as "[voice]" if that fails. Needs ffmpeg on the host.

### Settings and automatic updates

- Dropdowns and switches across settings use one set of components, consistent in light and dark themes.
- **Automatic updates** ("System → Version & updates"): off by default; daily at a set time or every 6/12/24/72 hours, optional allowed window; "notify only" or "update safely". An automatic install waits until she is not chatting and no backup, cleanup or migration runs, then uses the same verified flow as the manual update (checked backup → migrate → restart → health check → automatic rollback), never retries a version that failed, and keeps the last 20 entries. Source installs only notify.

## Quick start

Requires Node.js 24.5+ and npm on Windows, macOS or Linux. Real replies also need a model service and API key of your own.

```bash
npm install -g luckytri
luckytri
```

LuckyTri starts in the background and opens <http://127.0.0.1:3210>. The package includes the server, built WebUI, guides and bundled plugins. Set one management password on your first visit and use it to sign in later. Configure a model under System → Model library, then try simulated messages under Chat.

```bash
luckytri --no-browser   # launch without opening a browser
luckytri start          # foreground server, Ctrl+C to stop
luckytri stop           # stop this instance and wait for it to exit
luckytri paths          # configuration, data, logs, backups and package paths
luckytri setup          # initialize once, preserving existing configuration
luckytri backup         # integrity-checked database backup
luckytri --help
```

Stop the server before updating, then launch with the same user data:

```bash
luckytri stop
npm install -g luckytri@latest
luckytri
```

You can also check for and install updates under System → Updates in the WebUI. LuckyTri restarts after the update, and user data stays in the instance directory.

`npm uninstall -g luckytri` removes the program. Reinstalling uses the existing data. Installation and uninstallation run no application scripts.

Change your password or sign out under System → Run switches. If you forget it, run `luckytri reset-password` for the same instance and refresh the studio to set another. Database, memory and configuration stay intact. Launching after an update switches a running older service to the installed version.

### Developing from source

```bash
git clone https://github.com/TodayYueC/LuckyTri.git
cd LuckyTri
npm install
npm run setup
npm run build
npm start
```

Open <http://127.0.0.1:3210>. On Windows you can also double-click `启动LuckyTri.cmd` and stop with `停止LuckyTri.cmd`. For a first run, configure and test a model under System → Model library, then try a simulated message under Chat; simulated messages are never sent to QQ. The top right switches between 中文 and English.

## Connect QQ: pick one

Both ways share one mind. Only one is active at a time. Switch under System → Connect QQ, no restart needed. The official bot is much more limited about speaking first and about which group messages it can hear, so it is not a replacement for the OneBot connector. See the [capability survey](docs/en/qq-official-bot.md).

|                              | OneBot 11                                                              | QQ official bot                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| You need                     | An OneBot 11 endpoint of your own (reverse WebSocket) and a QQ account | A bot on the QQ open platform: AppID and AppSecret                                                                                                  |
| Logging in to QQ             | In the endpoint                                                        | Not needed                                                                                                                                          |
| Group messages               | All of them                                                            | All when "receive all messages" is on; otherwise only those that @-mention her                                                                      |
| Names                        | Group names and nicknames available                                    | The official API gives no group names; rename a session under Chat                                                                                  |
| Knowing people across groups | By QQ number                                                           | The same person has a different openid in each group; only recognized when the platform gives a unified identity                                    |
| Replies and reaching out     | No extra limits                                                        | Replies inside the passive-reply window, active messages outside it; if the other side turned active messages off she waits for them to come to her |

**OneBot 11**: enable a reverse WebSocket client using `ws://127.0.0.1:3210/onebot/v11/ws` and array messages. Local clients need no separate token; existing addresses and sign-ins can stay. Remote clients can use the management password, and legacy remote tokens remain supported.

**QQ official bot**: create a bot on the QQ open platform and get its AppID and AppSecret. Under System → Connect QQ choose "QQ official bot", enter them and save (or set `QQBOT_APP_ID` and `QQBOT_APP_SECRET`). Leave the console receive mode on WebSocket. If QQ stays quiet after the gateway is ready, read the [capability survey](docs/en/qq-official-bot.md) before changing the OneBot connector.

Details and differences are in [Connect QQ](docs/en/connect.md).

## Configuration, data and privacy

The global CLI initializes on first launch or through `luckytri setup`; source checkouts use `npm run setup`. Existing `.env` files are never overwritten. Default global user directories:

| Platform | User directory                              |
| -------- | ------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\LuckyTri`                   |
| macOS    | `~/Library/Application Support/LuckyTri`    |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/luckytri` |

This directory contains `.env`, `data/friend.db` (memory, relationships, chat history and studio settings), `data/knowledge/`, `data/plugins/`, `data/launcher.log` and `data/backups/`. `luckytri paths` shows the actual paths. npm updates, uninstallation and reinstallation leave these files intact. Launching does not depend on your current directory.

Set `LUCKYTRI_HOME` or use `luckytri --home ABSOLUTE_PATH` for a different instance; use the same value for launch, stop and backup. Relative `DB_PATH` and `BACKUP_DIR` values resolve under this directory. Global installs reject data paths inside the npm package.

To continue an existing source instance, stop it first, then use `luckytri --home ABSOLUTE_PATH_TO_OLD_CHECKOUT` with all commands. This reuses its `.env` and `data/` without copying the database. Database migrations and their snapshots still apply. To move to the default directory, stop the service and copy the complete `.env` and `data/` while retaining the old copy. Source checkouts continue to use their repository's configuration and data by default. Common settings:

| Variable                 | Purpose                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `HOST` / `PORT`          | HTTP address and port, `127.0.0.1:3210` by default                                       |
| `LUCKYTRI_HOME`          | Optional absolute instance directory containing `.env` and `data/`                       |
| `DB_PATH` / `BACKUP_DIR` | Optional database and backup paths; relative values resolve under the instance directory |

| `LUCKYTRI_CHANNEL` | Optional; `onebot` or `qqbot`. When set, the studio cannot change the connection |
| `ONEBOT_TOKEN` | Optional compatibility for an existing remote token; local clients need none |
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | QQ official bot credentials; take precedence over those saved in the studio |
| `QQBOT_TRANSPORT` | Optional; `websocket` (default) or `webhook`. The open platform treats them as mutually exclusive |
| `QQBOT_PROACTIVE` | Optional; `auto` (default, try a proactive send outside the window) or `passive` (passive replies only) |
| `QQBOT_WEBHOOK_PATH` / `QQBOT_API_BASE` | Optional; webhook path, and the OpenAPI origin |
| `LLM_API_KEY` | Optional; when set, takes precedence over the model key saved in the studio |
| `EMBEDDING_API_KEY` | Optional; a separate key for the knowledge embedding service |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | Automatic backup interval (24 hours by default, `0` turns it off) and how many to keep (7 by default) |
| `STICKER_MAX_MB` / `STICKER_ZIP_MAX_MB` | Per-sticker limit (default 4) and ZIP limit (default 1024), in MB |

The database, chat records, model keys and backups live locally in the ignored `data/` directory and are excluded from the repository and npm package. When you use a remote model, the context needed for a response is sent to your configured provider. While running, the server makes one integrity-checked backup a day; backups share a disk with the database, so copy important ones elsewhere. Never commit `.env`, the database or logs. See [Security](.github/SECURITY.md) and [Backup and recovery](docs/en/recovery.md).

## Documentation

| Document                                                     | Contents                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [Getting started](docs/en/guide.md)                          | From launching to letting her join her first conversation                     |
| [Connect QQ](docs/en/connect.md)                             | The two connection ways: comparison, steps and differences                    |
| [QQ official bot](docs/en/qq-official-bot.md)                | Capability matrix, why a connected bot stays silent, and the experiment path |
| [Her life](docs/en/her-life.md)                              | The unified mind: rhythm, solitude, diary, review, tact and boundaries        |
| [Architecture and extension points](docs/en/architecture.md) | Code layers, and how to add a channel, a mind module, a page or a translation |
| [Time, activities and works](docs/en/time.md)                | Her own activities, plans, works and sharing                                  |
| [Chat style](docs/en/chat-style.md)                          | How she speaks and the checks before sending                                  |
| [Studio design](docs/en/webui.md)                            | Design and upkeep of "TA's little world"                                      |
| [Backup and recovery](docs/en/recovery.md)                   | Backups, migrations, verification and restore                                 |
| [Changelog](docs/en/CHANGELOG.md)                            | What changed in each version                                                  |

## Development and tests

```bash
npm run dev:ui        # studio dev server
npm run build:ui      # build the studio into public/app
npm run docs:build    # generate the Chinese and English guide pages
npm run build        # build all release resources
npm test              # backend tests
npm run test:clock    # run the backend tests with the real clock moved into the past and the future
npm run test:ui       # browser tests (including the English UI)
npm run test:package  # real global install, upgrade, reinstall and data retention
npm run pack:check    # inspect the final npm file list and runtime resources
npm run release:check # complete release checks
npm run format:check  # code format check
```

The repository is layered by responsibility: `server/` (channels, core, mind, knowledge, storage, studio API, UI dictionaries), `studio-web/` (Vue 3 + Vite + TypeScript), `scripts/`, `tests/`, and `docs/zh` with `docs/en`. To add a channel or a mind module, start with [Architecture and extension points](docs/en/architecture.md).

See [npm release maintenance](docs/en/npm-release.md) for the release process and package boundaries. Maintainers can run `npm publish`; its hooks build, test and inspect the package automatically.

## 1.0

1.0 connects plugins. The core still defines who she is; a plugin decides what of the world she can touch. Each plugin runs in its own process and reaches her through Plugin API v1 and permissions accepted when it is enabled. It cannot read the database or the keys. The studio can enable the built-in plugins, import from the market or from outside, and remove them. See [Plugins](docs/en/plugins.md).

Directions we would like to take next (not promises):

- Stable data structures and migrations, so her continuity can be kept safely across versions;
- A reply guard that can only refuse, never rewrite;
- Recognizing the same person across platforms;
- Longer real-world evaluation runs, and more interface languages.

## License

LuckyTri's code is released under the [MIT License](LICENSE).
