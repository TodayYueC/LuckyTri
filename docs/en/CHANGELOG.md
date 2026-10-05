<p align="right"><a href="../zh/CHANGELOG.md">中文</a> · <b>English</b></p>

# Changelog


## 1.0.3 — 2026-10-06

- Group personas become thoughts about each place. She selectively adds, revises or lets go of impressions, wishes, preferences, questions and boundaries from local encounters, retaining reasons, sources and versions. Her overall personality remains shared; copied legacy personas stay only in history.
- Manual update checks in system runtime settings show the installed and latest npm versions and release notes. Checks cache and coalesce requests and recover from failures; they do not install or restart.
- Nature edit allowances come from the server. Audited, idempotent local extra opportunities preserve personality history and other instances' default limits.
- Added source isolation, selective updates, restart persistence, failed update recovery and responsive interface checks.

## 1.0.2 — 2026-10-06

- Streamed full SQLite data packages with validated import previews, retained recovery points and rollback on failure.
- Destination management sign-ins and connection settings are retained. Imported auto replies and plugin grants await review; cancelled, expired and interrupted temporary packages are reclaimed.

## 1.0.1 — 2026-10-05

- Global npm installation runs with `luckytri`, including the server, built WebUI, guides and bundled plugin. User data remains outside the package across updates and reinstalls.
- Set one password on the first studio visit. Remembered sessions, password changes, sign-out and a local reset command replace manual random-token setup. Only a salted password digest is stored.
- Local OneBot reverse clients need no separate token and retain existing addresses and sign-ins. Remote clients use the management password or a legacy token; cross-site browser upgrades are rejected.
- Launching restarts a running older version while retaining configuration, databases, backups and migrations.
- Added packaged-install, update, reinstall, password and connection checks, three-platform CI, and ignore rules for credentials and temporary database files.

## 1.0.0 — 2026-10-04

Plugins. The core still defines who she is; a plugin decides what of the world she can touch.

- **Plugin API v1.** A plugin can offer a channel, a sense, a sourced experience, material for an activity, an action she may choose, shelf reading and a sandboxed page. It cannot speak for her, and it cannot write her nature, self, bonds or memory.
- **Permissions are enforced.** Each plugin is a restricted process. Without the matching permission it cannot read her state, use the network, register a channel or call a model. Accepted once when enabled, and again if an upgrade asks for more.
- **Market and import.** The studio can browse an index, import a zip link, a GitHub repository, an uploaded package or a local folder, check sha256, roll back and remove. What she already lived through does not leave with the plugin.
- **A built-in plugin, off by default.** Weather.
- **Database version 4.** A snapshot is kept before the upgrade. With no plugin enabled, she behaves as in 0.9.9.

## 0.9.9 — 2026-10-02

The last tidy-up before 1.0: two ways to connect, a bilingual interface, rewritten documentation, and a cleaner, easier-to-extend repository.

- **QQ official bot, either-or with OneBot 11.** New `server/channels/` with a common channel contract and a `ChannelHub`: one channel is active at a time, switching while running needs no restart, and `LUCKYTRI_CHANNEL` can pin it. Both channels hand the core the same neutral message, so attention, memory, relationships, solitude, diary and time are fully shared; only how messages arrive differs. The official channel obtains and renews its access token, connects to the Open Platform gateway (heartbeat, resume, backoff reconnect), converts @-in-group, all-group and one-to-one events with de-duplication, replies to the original message inside the passive-reply window and sends proactive messages outside it, records whether a person has turned proactive messages off and uses that to decide whether she may reach out, and the limits on names and cross-group identity are documented.
- **Renaming sessions.** The official interface gives no group names, so on both channels you can rename a session under "Chat".
- **Bilingual.** The top-right corner switches between 中文 and English; Chinese is the default and the choice is kept in the browser. All interface text, dates and numbers, and the errors and labels the server shows in the interface have English; what she says, her diary, thoughts and reasons are not translated. Every document exists in both languages with matching file names and a language switch at the top.
- **No mention of any third-party connector.** System settings, the guide and the docs keep only connection address and token details, with no names or jump links.
- **Rewritten README and docs.** The new README explains the purpose, her day and the core framework; `docs/zh` and `docs/en` add architecture and extension points, a comparison of the two ways to connect QQ and the studio design, and refresh the rest. The guide page is generated in Chinese and English with Markdown downloads.
- **A cleaner repository.** Working notes from an instance and one-off repair scripts are removed; test corpora are synthetic sentences with unchanged validation semantics; `.gitignore` is hardened; a new `tests/repo-hygiene.test.js` scans for keys, instance data, local paths and third-party connector names. Version notes are now written in general terms and contain no runtime data.
- **A clearer structure.** Storage moved to `server/storage/`, readiness checks joined `server/studio/`, feedback, group voice and model presets joined `server/core/`, lifetime modules moved into `server/mind/life/`, evaluation and audit scripts into `scripts/dev/`, browser tests into `tests/ui/`; `server/version.js` is the single source of the version and fixes the stale version in the request header.
- **Small touches.** The placeholder and empty-state text of the dropdown select can be translated.

## 0.9.1 — 2026-09-29

- **Stickers read by tone.** A sticker with a usable picture can enter vision and the text label of an ordinary one enters the context. She first judges whether it is a joke, a rant or a new topic and no longer solemnly repeats the words in the picture.
- **New pictures judged by their own message.** Selective vision takes only the same person's current, explicitly quoted or adjacent images; cacheable vision notes keep only what is visible.
- **Rapid messages merged before the first line goes out.** A brief re-check was added before sending; when the other person adds more, the old draft is withdrawn and both are reorganized together. Crisis replies do not wait.
- **Wordplay and abbreviations decoded from context first.** When unsure she asks briefly, without lecturing or explaining the joke.
- **What she lives for is steadier.** The same wish in different words stays one entry; it is kept in mind when others' words touch it, when she says it, or when she writes a thought about it; writing a thought that puts the wish down stops pinning it; promises to others no longer take that seat. The end-of-day snapshot records it too.
- **The choices she made and her reasons come back at the next meeting.**
- **Continuity gained automatic backups.** While the service runs, an integrity-checked backup is made in another process every 24 hours by default and only the latest 7 are kept; `BACKUP_INTERVAL_HOURS=0` turns it off.
- **Small format slips in a model reply no longer lose a whole turn.** It is repaired where possible and the model is asked once more only when it cannot be.
- **More honest and steadier replies.** She does not say she played something she did not; presenting her own words as the other person's is sent back for a rewrite; when asked "how do you know?" the basis is checked first and something she raised unprompted cannot invent a message the other person sent; review no longer uses nature settings to veto her honest answer that she is a program.
- **When nobody calls her and her words are not in shape she stays silent**, instead of sending a one-word stand-in.
- **When she is addressed directly and the model is briefly unavailable, she retries later by herself** (once after 30 seconds and once after 2 minutes).
- **Solitude no longer idles.** When only time has passed and there has been repeated idling, the interval lengthens each time up to 6 hours; when her own thoughts only continue the previous one several times in a row, something new must be picked up for the thought to be kept.
- **Memory is separated from "who she is".** Opinions about topics no longer pile up in her self.
- **New `npm run audit:sent`** replays the replies she recently sent against today's checks; **new `npm run test:clock`** runs the backend tests with the real clock moved to the past and the future. Replay and trial chat no longer depend on the real clock.

## 0.9.0 — 2026-09-28

- **The vision is stated.** LuckyTri is about continuous experience, self and connection with the world; QQ chat is only the current doorway. The Chinese and English READMEs were updated together.
- **Only the generic OneBot 11 reverse-WebSocket connection is kept.** System settings show only the connection address and token details; the README and connection guide were rewritten.
- **Attention recognizes what she lives for.** When a topic touches `self.livingFor` she may chime in because she wants to, or stay quiet; the diary and night review can see it and only write about it when it was really touched.
- **A meeting leaves meaning, and a will counts only when touched.** What a meeting meant to her returns the next time that person is present; meaning fades with the days she has lived and, once faded, is only recalled by that same person's own words.
- **Discretion tightened everywhere.** Private words and secrets never enter another room through the diary, notes, impressions, meetings or reviews; a reply that would carry them is rewritten before sending. Words passing by in a session she is not in do not become her experience.
- **Relationships feel more real.** "Long time no see" is told apart from "still around but no words exchanged"; the same experience is never counted again and again as closeness; an impression kept in mind is not contact.
- **The rhythm of a room is not her character.** Sentence length and punctuation in a group go into `inner.room` and she speaks by her own habits.
- **Attention, touch counts and the long-absence list follow one rule:** two words from the same person's own speech; one phrase is not enough; two people's words are not combined; her own words do not count.

## 0.8.2 — 2026-09-26

LuckyTri admits she is made of code and a model, and still treats her heart, memory and choices as her own.

- **Stance**: the default nature is now someone already living her days. Asked who she is, she answers that she is made of code and a model; this life, what she remembers and the choices she makes are her own; she does not call herself merely an assistant and does not invent a body or experiences that never happened. She may think of someone because she wants to and never uses guilt to keep anyone.
- **Unmodified seed**: if the first version is still the nature shipped with an earlier release, it is replaced by the current seed on read, without using up the "only two edits" allowance.
- **Small things for herself**: solitude may leave one wish with no message source, with strength capped; the strongest one now appears as `self.livingFor`.

## 0.8.1 — 2026-09-25

The WebUI was rebuilt as "TA's little world": she is the center of the interface, a breathing, shape-shifting, blinking glow of soul that answers a poke, and colors, sky and motion follow mood and rhythm (seven themes: lively, sweet, calm, low, irritable, sleepy, night). The information architecture is TA (Now, Inner life, People, Lifetime), Daily life (Chat, Memory) and Settings (Nature, System); native browser dialogs became in-interface dialogs. New `GET /api/mind/presence`, `/api/mind/today` and `/api/mind/people/:id`.

**The weight of time**: she does not only accumulate, she also fades and looks ahead. Self threads, notes and memory fade by the days she has lived and return to view when a related topic recalls them (without writing); closeness falls after a long absence and warms on reunion; promises and expectations (others' arrangements, what she promised) can be undone; night sorting and a layered autobiography (diary → review → chapter → my journey so far).

## 0.8.0 — 2026-09-24 · StartSoul

One her, speaking from the heart, with days of her own.

- **Unified mind** (`server/mind/`): a versioned nature, a global mood, relationships consistent across groups, self threads that grow gradually out of experience, her face in each group, global notes. Every change cites its source and can be undone.
- **Speaking from the heart**: participation probability, cooldown and "always reply when @-ed" are gone. Each close look makes one model call that yields understanding, feeling, changes to people, a choice, a reason and the wording; mood and relationships change even in silence.
- **Attention**: a deterministic "look closely or glance"; ordinary group chat calls the model only when she cares.
- **Global memory and discretion**: one memory serves all sessions, labeled public / private / secret.
- **Lifetime**: daily rhythm, global solitude, reading, bedtime diary, night sorting, review, a rewritable autobiography and reaching out decided by her.
- **Token management**: a global ledger, a daily cap and background shares, a cache-friendly request layout.
- The old persona became the first version of nature and old data migrates automatically; the old per-session memory and probability mechanisms were retired.

## 0.7.0 — 2026-09-24

- New "Time" workbench, low-frequency solitude enabled per session and optional proactive messaging.
- Layered context compression: recent text stays verbatim, older chat is condensed into multi-level summaries.
- Requests reordered by cache rules; output caps per stage; finer network-error classes; jittered exponential backoff; per-model circuit breaking and a session-level fallback model.

## 0.6.0 — 2026-09-22

- Rebuilt the group chat core: messages are batched first, then speaker, @, quote chain and topic are resolved, and finally the speaking decision and the reply are produced separately.
- Long-term memory isolated by session, user and shared scope with confidence, source and expiry; model profiles support vendor presets, context window and vision ability; image understanding has an energy-saving mode.
- The WebUI was rebuilt in a fresh mint theme.

## 0.5.1 / 0.5.0 — 2026-09-21

- Project branding unified (now LuckyTri); the README became Chinese by default with English switchable.
- Model settings gained provider presets, reasoning effort, Temperature, Top P and maximum output tokens.
- A guided QQ connection step: a local OneBot token and reverse-WebSocket configuration, with QQ login still done in the connector; the project never receives or stores a QQ password.

## 0.4.0 — 2026-09-19

- Reply feedback: natural, too long, too stiff, too many memes, undoable.
- New getting-started guide with five connection steps; a complete Chinese guide; commands for configuration setup, stopping and consistent backups.

## 0.3.0 — 2026-09-19

- Plain everyday speech first, fewer fixed comforting templates; optional group-voice adaptation; a customer-service tone, repetition or piled-up memes trigger at most one rewrite.

## 0.2.0 — 2026-09-19

- Memory inbox, memory search and editing; model connection test and connection checks.
- Simulated and real context separated; cooldown and rate limits persisted; event de-duplication independent of context.
- SQLite query indexes and log retention caps.
