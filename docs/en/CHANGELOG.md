<p align="right"><a href="../zh/CHANGELOG.md">中文</a> · <b>English</b></p>

# Changelog

## 1.2.1 — 2026-10-13

- Fix message boundaries: a line break starts another message, while a list stays together; lines that continue the same thought are joined, within the turn's message limit.
- Normalize older sentence-per-line replies in her context and typing-style statistics, so an old layout does not keep teaching her to write that way.
- Let tired or tense feelings affect her energy more fully; add twelve explicitly synthetic regression scenes for reply shape.

## 1.2.0 — 2026-10-13

- Instance updates now run a versioned memory migration: make and verify a full snapshot, upgrade the database with the candidate release, merge legacy memory records, and rebuild full-text and experience-link indexes. Persistent row counts are checked table by table before switching versions. A failed migration restores the snapshot and restarts the previous release. Chat memories are not sent to a model, and existing vectors are not regenerated.

- The review prompt drops a duplicated “admitting fault scores no points” clause so that idea is stated once, trimming prompt bloat.
- The check of whether a reply answers the asker now treats “I don’t eat / have no body” as a real answer to “what did you eat”, not as dodging the question.
- Memory consolidation and summary merges join the other mechanical stages in turning off hidden reasoning, so background work no longer burns thousands of reasoning tokens to extract facts.
- A bare “you got it wrong” about a fact is no longer treated as a repair that must admit fault; only meta-critique of how she speaks (robotic, repetitive, unnatural) takes that path, and even then she checks whether she actually did.
- Older related lines pulled in from outside the chat window are deduplicated and capped at five, so eight near-identical old rows no longer fill the prompt.
- When someone claims she got a fact wrong without evidence, restating her own recent basis is no longer treated as empty rephrasing and rewritten twice; the turn payload also drops the humanMessages field that duplicated exchange.current.
- When two statements about someone do not fit together and neither is settled, recalling one now shows the other beside it, with when and where she heard it, instead of taking either for fact. A restricted one is only noted, not repeated.
- The check of whether a reply answers the person who asked now sees that person’s own earlier words on the same thing (at most two), so a correct answer to “that interview I mentioned, which day was it” is no longer taken for invention and rewritten again and again.
- Faster, cheaper replies: the review step that asks “did the reply answer the person who asked” no longer uses hidden reasoning (same accuracy on the review probe, about 93% fewer output tokens for that check); the main review keeps its configured effort, because without it an unsupported change of mind slipped through. On Volcengine, “no thinking” and mechanical stages now really disable thinking instead of using minimal reasoning; models that cannot (GLM) keep the old setting, and a model that refuses is asked again with minimal reasoning.
- Memory consolidation no longer drops an episode that is reworded but has a source for every clause (e.g. “pushed weekend basketball off too”); a one-clause note still has to end in words that were said.
- What happened after each choice is recorded: whether anyone answered her, a possible correction, whether she was called again after keeping quiet, and the owner's feedback, with the messages. Derived from the record without a model; turn input is unchanged. The audit reports it with samples.
- Bringing back her own notes with an affair is stricter: a single shared word that is not in the affair's title no longer counts. Notes and plans enter the recall index as soon as they are written.
- When an affair comes back to her, so does what she made of it: her note then and later, or an intention about it, at most two lines. Links come from the sources she already keeps, with no model call; private thoughts stay out of groups.
- Times over a week ago are no longer all "a long time ago": a week ago, two or three weeks ago, over a month ago, a few months ago, over a year ago.
- Revocations are stamped on her own clock, on the same timeline as the rest of her life.
- Each turn records what came to her mind (facts, episodes, self threads, thoughts, promises) in the choice record, kept for good and never sent to the model; turn input stays byte-for-byte the same. The database only gains one column, so older versions still open it.
- New `npm run audit:life -- --db <backup>`: a read-only check-up of a backup that reports on the integrity and continuity of her life record. New `npm run evaluate:traits`: trait probes with the scripted model.
- New Ultimate vision document; the evolution charter sits under it.
- Embeddings no longer default to doubao: any OpenAI-compatible `/embeddings` endpoint works with an address, a model name and a key, and Volcengine Ark (including Agent Plan) is one preset. With dimension 0 every model keeps its own length; doubao-embedding-vision stays at 2048 as in 1.1.2, so existing vectors are not rebuilt. In a recall comparison with real vectors 1024 was slightly worse, so it is no longer the default. Vectors returned as base64, the different ways services say a batch is too big, and a 413 without a limit are all handled.

## 1.1.2 — 2026-10-11

- Embedding length is no longer forced to 1024. Dimension 0 does not ask the service for a length, so doubao-embedding-vision uses its own 2048. A profile already saved as 1024 has to be set back to 0 and saved again.

## 1.1.1 — 2026-10-11

- The embedding service asks for its request address and key. The model name can be left empty; a Volcengine Ark address uses doubao-embedding-vision.
- The key is no longer a password field, so the browser does not treat it as a studio sign-in and ask to log in again. A 401 from the vector service is no longer treated as a signed-out studio.

## 1.1.0 — 2026-10-11

- She is the same person in every room. What was just said elsewhere comes into the current turn, and she knows it. She does not usually bring another place up here. When the person in front of her was part of it, she may continue or leave it unsaid. Private wording, secrets and another account's history still stay out.
- Every turn carries her own state: awake or asleep, energy, mood, what she is living for, and the people she is close to. That is for her, not a report to recite.
- Memory uses one rebuildable index. Facts, meetings, episodes, self, thoughts, diaries and promises can be found by meaning, words and who is present. Without an embedding model, keyword recall and recent context still answer, and conversation continues.
- The embedding service needs only an API key. Address, model and 1024 dimensions are chosen from the chat service. Those requests use their own lane and do not block replies.
- An affair is an episode thread from its start to its outcome. A follow-up that comes due is only a candidate and still passes the existing initiative gates. A lesson must cite lived experience, the same experience is used once, and two independent pieces establish it.
- Background failures no longer retry in a loop. Conversation stays ahead of upkeep, a permanent model error pauses that model, and a schedule clash takes the nearest free slot. The database schema moves to version 5 and copies the whole file before upgrading.

## 1.0.9 — 2026-10-11

- In follow-ups, answer the new detail without repeating limitations already explained; answer a question about source or feelings directly.
- Discuss project proposals using the details actually given, without inventing the other person's existing game mechanics or assignment. If a first bot reply misses a newly delivered passage or question, retry once for that content; empty confirmations still stop.
- For a concrete story excerpt, describe the visible events before clarifying that the larger plot is unknown.
- Reject duplicate JSON fields so a later `bubbles` field cannot silently replace an answer. Queued messages can see replies already delivered before their turn starts, reducing repeated acknowledgments and corrections.
- Distinguish questions, proposals, feelings and corrections. Reviews retain the necessary original words and participants to check mistaken adaptations and unsupported apologies. When a follow-up omits a work's title, use the immediately delivered reply to that same person in the same conversation to find reading records, returning only the reading fact, not the reply's text. Select old summaries by the current topic while preserving address agreements separately.
- Check repeated bot confirmations before they produce emotional changes. Verify new actions claimed in proactive drafts against activity records; old wishes cannot prove execution. Preserve history and readable source dates during review.
- Retain earlier repair constraints. Keep a shortened original reply only after every check passes again. Historical evaluations exclude future memories and self-feedback, record code fingerprints, and fail explicitly when requested cases are missing.
- Remove the unavailable OpenCode Zen Space Bunny Free and Step 5 Preview Free presets. On startup, remove their saved profiles while preserving other models and the default.
- Add a separate Volcengine Ark Agent Plan category with its auto-router and all 14 current text model IDs/aliases. Use the dedicated `/api/plan/v3` Responses API, official context sizes and vision capabilities; exclude Coding Plan, models already being retired, and image, video, speech and embedding models.

## 1.0.8 — 2026-10-10

- Rework dialogue instructions and context around the current question, proposal or feeling. Old activity reports, room shorthand and self-summaries no longer dominate ordinary exchanges. Greeting images retain their immediate context and agreed forms of address remain available.
- Allow natural recurring affection and greetings without forcing invented counts, elapsed-time reports or lifestyle advice. Complete reactions are no longer mechanically rewritten to fit a twenty-character limit.
- Preserve the actual addressee and quoted evidence in group conversations. Later laughter does not erase a serious question, and another bot's interpretation is not the person's confirmation. Empty bot reports do not create confirmation chains or relationship growth.
- Add an independent comprehensibility check for explanation requests; revisions and factual review retain the current question. Validation respects the configured reasoning effort.
- Recall relevant historical work versions without denying earlier reading because recent records are incomplete or revealing unrelated private text. Exclude unrelated web material from game progress and sharing while retaining the archive.
- Distinguish someone else's writing from her own reading promise. Waiting for a manuscript does not execute as writing or substitute another or older book. New self-expressions check actions and participants rather than turning wishes into completed experiences.
- Update both READMEs, capability boundaries and the release badge; expand historical replay, sequential group scenarios and regression coverage. Transcripts and model reports remain local.

## 1.0.7 — 2026-10-09

- Ground understanding in the current messages, supplements, speakers and quote chains before choosing a response. Corrections address the actual question instead of substituting apologies or abstract monologues.
- Keep single topical remarks out of the enduring self's core and prevent extracted replies from becoming fixed scripts. Related recollections, cross-conversation continuity and disclosure boundaries remain available.
- Exclude known bots from human room-style statistics and end empty bot confirmation loops. An explicit addressed stop ends the current turn; a renewed question can still receive a reply.
- Preserve provenance and uncertainty in game-content presentation. Current activities and work fragments distinguish reference reading and model-generated material from client operation or completion.
- Rewrite the latest rejected draft, allow requested factual repetition, and keep contradiction repairs confined to relevant questions. Conversation endings no longer receive an unrelated confusion fallback.
- Add full-corpus review, historical replay and sequential conversation evaluation tools. Paid model checks run explicitly; private transcripts and reports stay local and are excluded from release artifacts.

## 1.0.5 — 2026-10-07

- Fixed bound relationships being forgotten when the person was absent from the current conversation. Chat, initiative, solitude, diaries and reviews recall the same account-based ledger by name and role.
- Distinguished current relationship facts from past opinions and personal feelings. Historical denials and jokes remain in history; relationship-related replies are checked against current knowledge while preserving her choices about interaction and address.
- Relationship recall includes actual encounters and addressed replies, rather than treating capped emotional changes as conversation counts. Retrieval stays bounded and private relationships and impressions retain their disclosure boundaries.
- Obsolete reflections, diaries and reviews are not committed when relationships change during generation. The repair preserves history and personality edit allowances.

## 1.0.4 — 2026-10-06

- Account-based relationships for people and other robots, with reciprocal family/friend/custom roles, name, reason, visibility and history. Integrated into recognition, conversation, solitude, diaries, initiative and task choices without inventing trust or shared experiences.
- Removed the fixed LuckyTri identity from built-in nature and reflection prompts. Renamed instances use their configured identity; the exact old shipped rule is repaired without spending an edit. Other robots remain separate accounts.
- Update and restart stages and validates the official release before stopping, saves a verified data restore point, and switches programs. Failed startup attempts restoration of the previous code and data. Source/npm installs and instance configuration remain intact; repeated clicks coalesce and CLI launches retain managed updates.
- Added privacy, same-name identity, recovery, real installed-package switching and viewport regression checks. Archive checks verify bytes before parsing SQLite, so damaged files do not expose raw schema errors.

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
