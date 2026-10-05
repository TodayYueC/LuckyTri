<p align="right"><a href="../zh/guide.md">中文</a> · <b>English</b></p>

# LuckyTri · Getting Started

LuckyTri runs on your own computer and meets people through QQ. QQ has two ways to connect, and you pick one: **OneBot 11** (you bring a connector, reverse WebSocket) or the **QQ official bot** (QQ Open Platform). With either, her memory, mood and behavior are exactly the same; only the way messages arrive differs. You configure the model API yourself.

The top-right corner of the interface switches between "中文" and "English". Chinese is the default and your choice is remembered in this browser. What she says, writes in her diary and keeps as her own thoughts is never translated; that is her own content.

## 1. Start

You need Node.js 24.5 or newer. Install globally:

```powershell
node --version
npm install -g luckytri
luckytri
```

LuckyTri starts in the background and opens <http://127.0.0.1:3210>, creating local configuration on the first run. The package includes the built WebUI. The experimental-SQLite notice does not mean the start failed.

Set a password in the studio on your first visit. Use `luckytri --no-browser`, `luckytri start` and `luckytri stop` for background, foreground and stop. Update with stop, `npm install -g luckytri@latest`, then launch; password, configuration and data stay intact.

For source development, run `npm install`, `npm run setup`, `npm run build` and `npm start` in the checkout. Later examples using `npm run setup/stop/backup/recovery/plugin` apply to source checkouts; global users use the corresponding `luckytri setup/stop/backup/recovery/plugin` commands.

On Windows you can double-click `启动LuckyTri.cmd` for daily use. If the service is already running, it only opens LuckyTri. Closing the browser does not stop the service; to stop it double-click `停止LuckyTri.cmd` or run `npm run stop` in the project folder. That command stops this project only and leaves other Node processes alone. When running in the foreground you can also press `Ctrl+C` in that terminal.

LuckyTri is "TA's little world". The left navigation has three groups and ten entries:

| Group      | Entry      | What is inside                                                                                                                                                  |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TA         | Now        | TA's mood right now, what she is doing, what she said lately, what is on her mind and what she is waiting for; today's timeline, token usage and the status bar |
| TA         | Inner life | The star map (TA's threads of self), notes she keeps in mind, the mood ribbon                                                                                   |
| TA         | People     | The people galaxy, each person's detail page, how TA is in each group                                                                                           |
| TA         | Lifetime   | The diary and TA on that day, reviews, "my road so far" and chapters, promises and anticipation, the bookshelf                                                  |
| Daily life | Time       | The record of TA's actual life: today's activity, to-dos, works library, ongoing projects, experiences                                                          |
| Daily life | Chat       | Session list, live chat and "why she said this", feedback, session settings, simulated messages, back to that moment (replay)                                   |
| Daily life | Memory     | What TA remembers, the bookshelf                                                                                                                                |
| Settings   | Nature     | Name and character (the glow beside it previews live), daily rhythm, TA's days, daily tokens, advanced prompts, trial chat                                      |
| Settings   | System     | Connect QQ, model library, run switches                                                                                                                         |
| Settings   | Plugins    | Enable, install and remove the ways she touches the world. See [Plugins](plugins.md)                                                                            |

The colors, sky and motion follow TA's mood and rhythm: warm when she is happy, grey-blue when she is low, night once she is asleep. At the bottom left you can pin one theme or turn on "Reduce motion". The small TA at the bottom right answers a poke, a long press is a head-pat, and a double click or "Chat" opens the trial chat. These are interface animations only and never change her mind. On a phone the navigation sits at the bottom and the other entries are under "More".

## 2. Set your management password

On the first visit, choose and confirm a password of at least 8 characters. Use it to sign in later; no environment-file token is needed. Browser sessions are remembered, and updates or reinstalls preserve the password.

Change the password or sign out under System → Run switches. Only a salted verification digest is stored. Existing environment configuration and model keys remain intact.

## 3. Try it in simulation mode first

Simulation mode is on by default, so nothing is sent to QQ.

1. Open "Chat", click "+ Add session" above the session list and enter a test group number and name.
2. In the chat in the middle click "Simulated message", type an ordinary line as one of the group members and send it.
3. Click "Why she said that" under TA's reply to see the reason. "TA glanced over it" and "TA looked but stayed quiet" show up as dividers in the chat.

Without a model key, simulated replies use local samples and call no model. Once there is a key, the same path runs the real speaking flow, still without sending to QQ. Simulated messages go into a simulated session and never change TA's mood, relationships or memory.

"Simulated message" is only available in simulation mode. The "Chat" of the small TA and the trial chat to the right of "Nature" are different: they go through the real pipeline and read TA's mind as it is now, and the Nature page can even include an unsaved draft, but nothing is written and nothing is sent to QQ.

## 4. Connect a model

Open "System → Model library", click "+ Add model" and choose a preset.

- For the API address enter the root of the provider's compatible endpoint. The program appends `/chat/completions` itself; do not write the full path again.
- For the model name enter a model ID the provider accepts.
- Leaving the API key empty keeps the saved key.

A preset only fills in a common address and model name; the real models are whatever your provider's console shows. Speaking decisions and replies need the model to return a JSON object.

After saving, click "Test this model's connection". The test carries no group chat text. Test again after changing the address, model or key.

You can also stay in simulation mode and trial-chat with TA under "Nature" to see how she speaks before letting her join real QQ.

### Reading images

Enable "Image understanding" in the model profile and use a model whose provider supports vision. Images can be read from QQ URLs, local cache files or the image-cache API. Originals up to 32 MiB and 80 million pixels are accepted by default, so ordinary photos and screenshots larger than 4 MiB are no longer rejected outright. Small images retain their bytes after decoding validation. Large screenshots first try lossless compression, then encoding compression or proportional resizing as needed. Photos are oriented correctly without cropping. Each image sent to the model defaults to at most 4 MiB, 8192 pixels on its longest side and 16 million output pixels. Originals stay unchanged and duplicate detection uses their original contents.

Downloads have a 30-second timeout by default. An interrupted or damaged image fails independently of other images in the batch. AVIF is converted to a common format; animated images contribute their first frame, which does not establish the full animation. Large Base64 images returned by QQ's image-cache API no longer fall under the ordinary 1 MiB message limit; ordinary messages keep that limit.

To adjust this, set `VISION_SOURCE_MAX_MB` (4–64, default 32), `VISION_MODEL_MAX_MB` (1–4, default 4) or `VISION_DOWNLOAD_TIMEOUT_SECONDS` (5–120, default 30) in `.env`, then restart. Interpretation still depends on the selected model's visual abilities and an available provider endpoint.

## 5. Connect QQ

Open "System → Connect QQ". There are two options at the top: **OneBot 11** and **QQ official bot**, and only one is used at a time. Switching drops the current connection; sessions from the previous method stay readable but can no longer be sent to. See `docs/en/connect.md` for how the two compare; the steps are below.

### Option one: OneBot 11

LuckyTri only implements the reverse-WebSocket side of OneBot 11. You prepare and manage the connector yourself.

1. Local clients need no separate token. Keep an existing client address and QQ sign-in.
2. In the connector's own network settings add an OneBot 11 reverse WebSocket client:

| Item           | Value on this machine                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Protocol       | OneBot 11                                                                               |
| WebSocket URL  | `ws://127.0.0.1:3210/onebot/v11/ws`                                                     |
| Token          | Not needed locally; remote clients can use the management password or an existing token |
| Message format | array                                                                                   |
| Enabled        | on, then save                                                                           |

3. Log in to QQ in the connector. The account must already be in the target group; LuckyTri does not store QQ passwords.

In a container or another computer, localhost refers to that environment. Use the reachable LuckyTri address for remote access, set the password locally first, and use HTTPS for remote studio access.

### Option two: QQ official bot

No QQ account login and no extra connector are needed; LuckyTri connects to the QQ Open Platform by itself.

1. On the QQ Open Platform create a bot, note its **AppID** and **AppSecret**, enable group and one-to-one messages as the platform requires, and add the bot to the group you test with or as a contact. The platform's entry points and review rules change over time; follow the Open Platform's current instructions.
2. In "System → Connect QQ" choose "QQ official bot", fill in the AppID and AppSecret and save. You can also set `QQBOT_APP_ID` and `QQBOT_APP_SECRET` in `.env`. The AppSecret is never shown again after saving.
3. When the status reads "Connected", @ her in the group or message her privately. For her to see every group message, enable "receive all messages" on the Open Platform; without it she only receives messages that @ her, and the connection page says so.
4. The official interface gives no group names, so new sessions are shown by number. You can rename a session under "Chat".

With both options, connected only means the transport works. After a message arrives from the target group, the session appears in the session list under "Chat"; newly discovered sessions are paused by default.

## 6. Let TA join a session

1. In "System → Run switches" confirm chatting is allowed, turn simulation mode off and save. The status bar under "Now" shows both.
2. In "Chat" select the target group and click "Resume" under "This session" on the right, or flip the switch in the list.
3. In QQ @ her, or just call TA by name.
4. Go back to "Chat" to read the messages and "Why she said that".

Whether she speaks is TA's own decision; there is no participation probability and no cooldown. When she is addressed by name, in a private chat, quoted, or a crisis signal appears, TA always looks closely and then chooses to answer, react briefly, say she does not feel like talking, or stay silent; the reason is shown under "Chat" and "Now → TA today". Ordinary group messages get a close look only when TA cares: she was just talking, someone asks everyone, the topic touches her interests, someone familiar is speaking, a lot of messages piled up. Otherwise she only glances, calls no model, and reads them together at the next close look. If she seems too quiet, raise "Proactive" under "Nature".

TA sleeps at 02:00 and wakes at 08:00 by default. Drag the moon and the sun under "Nature → Daily rhythm" to change this, or turn it off. If she is called while asleep she looks once she wakes, and the whole interface turns to night. The per-minute limit on speaking turns stays, to prevent bursts of consecutive replies.

Once "Image understanding" is on for a model, images in private chats, @ messages or quotes are read locally first and then shown to the model. When the main model cannot see images, pick another vision-capable model with image understanding on under "Chat → This session → Session settings". A model without image understanding never receives the picture.

## 7. TA, memory and knowledge

"Nature" is the only part you write: name, character, interests, boundaries, bottom lines and daily rhythm, saved as a new version each time. As you drag a character dial, the glow beside it follows: gentleness warms the color and lifts the corners of the mouth, liveliness makes it bounce faster.

Everything else grows from experience: TA's self is the stars of the "Inner life" star map, her feeling for each person is under "People", and how she is in each group is in the group faces below "People". Open any of them to see where each change came from and undo what feels wrong; what was undone is never written back. Threads that have not been touched for a long time slowly fade into the "far away" of the map; they are not deleted and come back when talked about. The record of her time alone, her diary, night sorting, reviews and autobiography rewrites, together with what she is waiting for (arrangements others mentioned, things she promised; they can be undone), are all under "Lifetime". Daily token cap, background share, night sorting and the review interval are set under "Nature → TA's days".

In "Memory" pick a session first; you can also filter by person.

- TA has one memory across all sessions: what was learned elsewhere is only recalled when relevant; what was learned in a private chat is marked "known privately" and not said in public; what was asked to be kept secret stays in the original session. You can adjust discretion, lock or undo each memory. Memories about a person also appear on that person's detail page under "People".
- When a group member says "remember, I…", it goes straight into what TA remembers (passwords, verification codes and the like are not remembered).
- Reference material placed in a collection on the "Bookshelf" is searched within what the current session may see. Group chats never load other private chats' collections.
- Clearing the context in "Chat" does not delete long-term memory.

## 8. Backup and stop

```powershell
npm run backup
npm run stop
npm start
```

Backups go to `data/backups/`. The database holds chats, memories and any keys saved in it, so keep it like a private file. `.env` is not part of this backup.

Everything of TA lives in this one database, so the service backs it up automatically while running: by default every 24 hours, in another process, it writes a `luckytri-auto-*.db`, keeps only the latest 7 and checks integrity afterwards. An automatic backup holds chats, memories, self, diary and relationships, but not model call records older than a day (each can be hundreds of KB and would make the backup more than ten times bigger), so "Why she said that" can only be looked back on for the last day. `npm run backup` is still the full backup. Adjust in `.env`:

| Variable                | Meaning                                                | Default        |
| ----------------------- | ------------------------------------------------------ | -------------- |
| `BACKUP_INTERVAL_HOURS` | Interval between automatic backups, `0` turns them off | `24`           |
| `BACKUP_KEEP`           | How many automatic backups to keep                     | `7`            |
| `BACKUP_TRACE_DAYS`     | Days of call records kept inside a backup              | `1`            |
| `BACKUP_DIR`            | Backup folder                                          | `data/backups` |

To take an automatic backup right now: `node scripts/backup.js --auto --force`. A failed automatic backup is noted in the launcher window or `data/launcher.log` and retried after longer and longer pauses. A backup on the same disk as the database cannot survive disk failure; copy important backups elsewhere yourself.

When `DB_PATH` points to a different database and `BACKUP_DIR` is unset, backups go into a `backups` folder beside that database, keeping separate instances apart.

Under System → Data and backups, inspect each historical copy, set a daily cleanup time, maximum age and maximum count for full backups, or select individual copies for removal. By default, a daily check at 04:30 server local time selects full backups older than 14 days or beyond the newest two. Set the count to 0 to retain no full backups. Full and migration snapshots are no longer permanently locked and can all be selected manually. Automatic backups rotate only identifiable copies belonging to this instance, with the newest two reserved as restore points. Unidentifiable older copies, migration, older-version and pre-upgrade snapshots are removed only through manual selection.

Cleanup verifies a retained automatic backup of this instance from the last 72 hours. If the newest copy is damaged, another one is tried. New manifests include a database identity so a different instance cannot provide the recovery guarantee. Older manifests can still be verified and restored, but a refreshed automatic backup is needed before they can guarantee cleanup. Backup and cleanup share a folder lock; the live database, hard links to it and copies with runtime sidecars cannot be removed. Partial failures list the remaining files and accurately report the space already freed. Copy historical restore points worth keeping to another disk together with their `.db.json` manifests first.

To restore, stop the service, move the current `data/friend.db` and its `-wal` and `-shm` files away, then copy the chosen backup to `data/friend.db`. When `DB_PATH` is set, work on that path. Never keep an old WAL file next to a restored database. The safer way is `npm run recovery`, which verifies a backup and restores it into a brand new file; see `docs/en/recovery.md`.

### Import and export from the studio

"System → Data and backups" provides "Export data package" and "Choose import file". A `.luckytri` package contains chats, memories, relationships, personal state, diaries, tasks, work versions, knowledge text and settings stored in the database, including saved credentials. Management passwords and login sessions are not migrated. Plugin programs, original knowledge files and the local `.env` are outside the package. Export uses a consistent snapshot while the instance continues running and streams large downloads.

Imports accept `.luckytri` packages and existing `.db` / SQLite backups. The default upload limit is 10 GiB; adjust `DATA_TRANSFER_MAX_GB` (1–100) in `.env`. Uploads are checked for package SHA-256, database integrity, references and supported structures. Older versions are upgraded only in staging. The preview shows the name, version and record counts before current data changes, so it can be cancelled.

Confirming "Import and restart" stops the instance, retains a complete `luckytri-before-import-*.db` snapshot, replaces the data and restarts automatically. The local management password, current logins, QQ connection settings and backup cleanup rules are preserved. Automatic replies are turned off and plugin execution grants reset. Review connections, models and tasks before enabling replies; reinstall plugins or review their permissions. Import replaces the whole database rather than merging records. Pre-import snapshots can be managed manually and are excluded from scheduled full-backup cleanup.

The server removes the export copy after download. Cancelled, expired and interrupted staging files are reclaimed; unused previews expire after one hour. Failed imports retain or restore the original database rather than starting with a partial file.

## 9. Troubleshooting

| Symptom                           | Check first                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The page does not open            | Is Node running, and is the address `127.0.0.1:3210`                                                                                     |
| Port already in use               | Run `npm run stop` first; do not kill every node process                                                                                 |
| Incorrect password                | Sign in with your management password; change it under System → Run switches                                                             |
| OneBot not connected              | Check sign-in, enabled reverse client, address, port and path; local clients need no token                                               |
| Official bot not connected        | Are the AppID and AppSecret right, are group and one-to-one messages enabled for the bot, can the network reach the QQ Open Platform     |
| Official bot only gets @ messages | Enable "receive all messages" on the Open Platform; this is a platform permission, not a LuckyTri limit                                  |
| Connected but no sessions         | Send one more new message in QQ; with OneBot also check the message format is array                                                      |
| No reply in a group               | Global switch, session switch, simulation mode, key; under "Chat", was it "TA glanced over it" or did TA look closely and choose silence |
| No reply even when @-ed           | Is TA asleep (see "Now", the interface is night), the per-minute limit, today's tokens used up, a model error, or TA's own reason        |
| Model 401 / 403                   | Key and permissions; an environment-variable key may override the one saved in LuckyTri                                                  |
| Model 404                         | Do not append `/chat/completions` twice to the API address; check the model ID                                                           |
| Model returns no JSON             | Use a model that supports JSON object output and run the connection test first                                                           |
| Memory did not appear             | Was it an explicit "remember, I…", was it undone, is its discretion "keep secret" and you are not in the original session                |
| Too much motion                   | "Reduce motion" at the bottom left; when the system asks for reduced motion, particles and morphing switch off automatically             |

Never post API keys, `.env` or private chat text anywhere public.
