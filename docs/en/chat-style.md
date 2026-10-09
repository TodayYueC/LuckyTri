<p align="right"><a href="../zh/chat-style.md">中文</a> · <b>English</b></p>

# How she talks, and the checks before she sends

The goal is to pick up the specific thing a group is talking about and answer in relaxed, plain speech. She does not prove herself by playing a type of person; how she speaks comes from her nature, her mood right now, how she feels about who is present, and the way she has grown into this place.

## How she speaks

By default she speaks plain, everyday language:

- Everyday replies are usually short, and a reaction of a word or two is fine; a necessary piece of advice is never cut just to be short.
- She reacts to the specific thing, instead of following a fixed "repeat the feeling, comfort, advise, ask a question" routine.
- Venting is not assumed to want advice; good news does not get a consoling answer; jokes are put away when someone is really hurting.
- A conversation may simply end; she does not ask "and then?" every turn and does not turn every message into a joke.
- Ordinary replies name the actual people, events and actions instead of replacing them with accounting or carrying metaphors. Literal accounting, literature and requested metaphors remain valid.
- When someone says she is abstract or repetitive, she checks her last sentence and explains its actual meaning instead of merely acknowledging the complaint.
- She uses memory only when it relates to the current topic and does not show off a memory file; when a reference is unclear she asks, and never invents experiences.
- She does not force slang to seem young. A serious setting beats style.

The following are hand-designed directions, not results measured on an external model (the Chinese originals are the intent; here they are rendered loosely):

| They say                                                  | Direction we want                          |
| --------------------------------------------------------- | ------------------------------------------ |
| Five minutes to clocking off and the boss dumps more work | Of course it picks right now               |
| None of what I revised came up                            | Not a single guess landed                  |
| I passed the interview!!                                  | Nice!! That calls for a little celebration |
| Don't advise me, just let me rant                         | Okay, rant away, I'm listening             |
| I'm going to take a shower                                | Go ahead                                   |

## The rhythm of this place

In a group she hears the rhythm in which others speak there. It switches on after at least 12 distinct messages from 3 members within the last 7 days of ordinary human text, with each member contributing at most 8 so one talkative person cannot stand for the whole group. It measures common sentence length, the share of short sentences, closing punctuation, emoji and the frequency of conspicuous internet slang.

The statistics reach her only as `inner.room` and are **not her character**: she speaks by her own habits, need not copy them, and need not deliberately sound different. The adapter builds no profile of anyone's verbal habits, quotes no member, and does not treat commands in a group as settings; links, long texts, code, image placeholders, repeats, obvious abuse and common sensitive fields are filtered out. The statistics never cross groups, private chats or simulation mode.

## Feedback

Accounts marked as bots in relationship records do not contribute to room style statistics. Their messages and shared experiences remain stored. Uninterrupted bot exchanges stop when they are only confirming or rephrasing the same thing without a new question or concrete event. Identity comes from account records, never nicknames. Questions, corrections and requested creative work can continue. Confirmation loops do not create additional emotional or relationship changes.

Her long-term self stays stable across new topics. Related self recollections appear in `inner.relatedSelf`; `inner.onMind` includes relevant notes without filling unused slots with unrelated thoughts. Temporary lines do not become fixed reply habits. Existing records are retained, while fixed scripts stop being offered as expression preferences.

Under "Chat" you can give feedback on a reply she sent: natural, too long, too stiff, too many memes, or undo it. Feedback is not a rewrite rule: it reaches her as something she heard, read by herself during solitude and in the next turns of that conversation, and it never rewrites her nature.

## Checks before sending

Before a reply goes out, local checks look for:

- a customer-service or consulting tone, list-like report replies, stage actions;
- unfounded intimate forms of address, excess length, repetition, back-to-back questions;
- recent replies that mostly repeat earlier wording with a small addition; explicitly requested quotes and factual repeats remain valid;
- ignoring "no advice needed", joking in a serious setting, piled-up slang;
- presenting her own earlier words as the other person's ("you just said…" when their record has no such line);
- claiming to have played or finished something (she has no record of such experience; a liking is not a record of having played);
- secrets and things known privately must not be said in another room.

When she is asked "how do you know?", the basis is checked first: for something she said unprompted (the other person had been silent for two hours or more), the basis can only be a guess or a real memory, never that she saw a message they sent; if a rewrite still invents a source, a verified correction is sent instead.

Ordinary replies get at most two rewrites; initiative and high budget pressure allow one. Each rewrite receives the actual rejected draft and preserves meaning and facts. If it still fails, an unaddressed turn stays silent; a direct exchange admits that she has not worked it out instead of pretending to understand with a filler word. Answers are never simply truncated. Rejected trailing hh decoration can be removed, followed by all checks again, preserving useful content.

Feelings, corrections, crises, abstract bot exchanges, attribution and capability claims may require review of each draft, increasing latency and cost. Rewrites are bounded. Conservative checks cannot catch every stiff or incorrect expression; naturalness still depends on the model, nature and group context.

## How to try it

- **Trial chat**: on the right of the "Nature" page, or the small TA at the bottom right. It runs the same pipeline as QQ and reads her mind as it is now; the Nature page can also include an unsaved draft. Trial chat is not stored, not sent to QQ and creates no memory.
- **Simulated message**: under "Chat", only in simulation mode; it goes into a simulated session and never changes her mood, relationships or memory.
- **Replay**: "Back to that moment" reads only the mind as it was before then.
- **Audit**: `npm run audit:sent` replays the replies she recently sent against today's checks, read-only and without calling a model. Run it before changing a check to see whether the new rule would hurt. The replies already passed the checks when sent, so the number is for judging a new rule, not a score of how well she talks.

For real acceptance, watch 10–20 consecutive turns rather than a single line: does she pick up details, ask questions too often, repeat catchphrases, talk over others, suddenly turn into customer service, or mix up a joke with real sadness. Automated tests cover engineering constraints and hand-made scenario samples; the language quality of a real model still depends on your own observation.

In the source checkout, run `node --env-file-if-exists=.env scripts/dev/evaluate-dialogue.js --limit 120` for live-model replay through understanding, validation, review and rewriting, followed by a separate quality review. This uses the configured default model and incurs model costs. It never connects to QQ or changes the running memory. Reports stay in local `data/evaluations/`. Model errors, unresolved issues and fallback replies fail the run. A single model's review has limitations; inspect the actual outputs too.

Additional source-checkout checks:

- `node --env-file-if-exists=.env scripts/dev/audit-dialogue-corpus.js` reads every live message in overlapping conversation blocks and records coverage. Missing evidence in one block is a lead to investigate, not proof of fabrication.
- Replay with `--current-nature --rebuild-mind --review-model <profile-id>` to rebuild historical mind selection in an in-memory copy while retaining saved activity progress, and use a separate reviewer. `--model <profile-id>` selects an evaluation model without changing the live instance. This does not reproduce historical external services or images.
- `node --env-file-if-exists=.env scripts/dev/evaluate-dialogue-sequences.js --review-model <profile-id>` carries generated replies into the next turn and checks corrections, boundaries, affection, factual provenance and consistency over a conversation.

These commands incur model costs. Reviewers can miss errors or cite the wrong sentence; inspect their evidence. Combinatorial rule checks are not equivalent to the same number of distinct semantic conversations, and no test establishes perfect future conversation quality.

Current dialogue receives a factual `exchange` tail with new messages, quote chains and recent own words. Its short `understanding` summary remains revisable. Single extracted topical views stay retrievable without becoming enduring core traits; a one-off extracted habit does not become a response script. Reference-based game activities and model-generated material retain provenance and uncertainty instead of being presented as client operation. Reply review has an independent evaluator role and does not inherit the character's performance instructions.
